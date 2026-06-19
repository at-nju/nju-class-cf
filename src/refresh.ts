import { loadStatic } from "./adapters/static";
import { fetchSeatable, njuTableBase, fork25Base, astraBase } from "./adapters/seatable";
import { dedup } from "./dedup";
import { buildPinyin } from "./pinyin";
import type { Entry } from "./entry";
import type { Env } from "./index";

const ROWS_PER_STMT = 11; // 9列 × 11行 = 99绑定参数 (D1限制最多100个)
const STMTS_PER_BATCH = 50; // 每个 batch 的语句数

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// 内容哈希：稳定序列化整套去重后条目（条目间排序、sources 内排序），用于判断数据是否变化。
export async function hashEntries(entries: Entry[]): Promise<string> {
  const SEP = "\u001f"; // 字段分隔符，避免相邻字段拼接产生歧义
  const canon = entries
    .map((e) => [e.course ?? "", e.teacher ?? "", e.review, [...e.sources].sort().join(",")].join(SEP))
    .sort()
    .join("\n");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 写入暂存表，原子替换至正式表并重建 FTS，同时把内容哈希写入 meta（与数据同事务）。
// 拼音是写库时的派生物，在此内联算出。
export async function writeToD1(db: D1Database, entries: Entry[], contentHash: string): Promise<void> {
  await db.prepare("DELETE FROM reviews_staging").run();

  const rowChunks = chunk(entries, ROWS_PER_STMT);
  let id = 0;
  let pending: D1PreparedStatement[] = [];

  const flush = async () => {
    if (pending.length === 0) return;
    await db.batch(pending);
    pending = [];
  };

  for (const rc of rowChunks) {
    const placeholders = rc.map(() => "(?,?,?,?,?,?,?,?,?)").join(",");
    const binds: unknown[] = [];
    for (const e of rc) {
      id += 1;
      const tp = buildPinyin(e.teacher);
      const cp = buildPinyin(e.course);
      binds.push(
        id,
        e.course,
        e.teacher,
        JSON.stringify(e.sources),
        e.review,
        tp.py,
        tp.initials,
        cp.py,
        cp.initials,
      );
    }
    pending.push(
      db
        .prepare(
          `INSERT INTO reviews_staging
             (id, course, teacher, sources, review, teacher_py, teacher_initials, course_py, course_initials)
           VALUES ${placeholders}`,
        )
        .bind(...binds),
    );
    if (pending.length >= STMTS_PER_BATCH) await flush();
  }
  await flush();

  // 原子替换：清空旧数据，从暂存表导入，并更新 FTS
  await db.batch([
    db.prepare("DELETE FROM reviews"),
    db.prepare("DELETE FROM reviews_fts"),
    db.prepare(
      `INSERT INTO reviews
         (id, course, teacher, sources, review, teacher_py, teacher_initials, course_py, course_initials)
       SELECT id, course, teacher, sources, review, teacher_py, teacher_initials, course_py, course_initials
       FROM reviews_staging`,
    ),
    db.prepare(
      `INSERT INTO reviews_fts (rowid, course, teacher, teacher_py, course_py)
       SELECT id, course, teacher, teacher_py, course_py FROM reviews`,
    ),
    db.prepare("DELETE FROM reviews_staging"),
    db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('content_hash', ?)")
      .bind(contentHash),
  ]);
}

// 刷新数据：拉取 SeaTable、合并静态数据、更新 D1
export async function refresh(env: Env): Promise<number> {
  const bases = [];
  if (env.SEATABLE_API_TOKEN) bases.push(njuTableBase(env.SEATABLE_API_TOKEN));
  if (env.SEATABLE_FORK_API_TOKEN) bases.push(fork25Base(env.SEATABLE_FORK_API_TOKEN));
  if (env.SEATABLE_ASTRA_API_TOKEN) bases.push(astraBase(env.SEATABLE_ASTRA_API_TOKEN));

  const seatableEntries = (await Promise.all(bases.map((base) => fetchSeatable(base)))).flat();
  const entries = dedup([...seatableEntries, ...loadStatic()]);
  await writeIfChanged(env.DB, entries);
  return entries.length;
}

// 仅使用静态数据填充 D1
export async function seedStaticOnly(env: Env): Promise<number> {
  const entries = dedup(loadStatic());
  await writeIfChanged(env.DB, entries);
  return entries.length;
}

// 内容未变则整体跳过写库（仅 1 行读、0 行写）；变了才走全量重建并更新哈希。
async function writeIfChanged(db: D1Database, entries: Entry[]): Promise<boolean> {
  const newHash = await hashEntries(entries);
  const cur = await db
    .prepare("SELECT value FROM meta WHERE key = 'content_hash'")
    .first<{ value: string }>();
  if (cur?.value === newHash) {
    console.log("Data unchanged, skipping D1 rebuild");
    return false;
  }
  await writeToD1(db, entries, newHash);
  return true;
}
