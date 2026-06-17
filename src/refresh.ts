import { STATIC_SOURCES } from "./data/static";
import { fetchSeatable, njuTableBase, fork25Base } from "./seatable";
import { mergeEntries, type ReviewRow } from "./merge";
import type { Env } from "./index";

const ROWS_PER_STMT = 11; // D1 单条语句最多 100 个绑定参数；9 列 × 11 = 99
const STMTS_PER_BATCH = 50; // 每个 db.batch 的语句数（≈550 行/批，减少往返）

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// 把合并好的行写入暂存表，再一次性原子换入正式表 + 重建 FTS。
export async function writeToD1(db: D1Database, rows: ReviewRow[]): Promise<void> {
  await db.prepare("DELETE FROM reviews_staging").run();

  const rowChunks = chunk(rows, ROWS_PER_STMT);
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
    for (const r of rc) {
      id += 1;
      binds.push(
        id,
        r.course,
        r.teacher,
        JSON.stringify(r.sources),
        r.review,
        r.teacher_py,
        r.teacher_initials,
        r.course_py,
        r.course_initials,
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

  // 原子换入：清空正式表与 FTS，从暂存表整体灌入，再清空暂存表。
  // INSERT ... SELECT 在 D1 服务端执行，无参数绑定，速度快。
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
  ]);
}

// 完整刷新：拉 SeaTable → 合并静态历史源 → 算拼音 → 重写 D1。
// 任一步失败则抛出，调用方保留旧数据（不清表），与原后台线程的容错一致。
export async function refresh(env: Env): Promise<number> {
  // 两个 base 都可选：配置了哪个 token 就拉哪个。
  const bases = [];
  if (env.SEATABLE_API_TOKEN) bases.push(njuTableBase(env.SEATABLE_API_TOKEN));
  if (env.SEATABLE_FORK_API_TOKEN) bases.push(fork25Base(env.SEATABLE_FORK_API_TOKEN));

  const seatableGroups = [];
  for (const base of bases) {
    seatableGroups.push({ fallbackSource: "seatable", entries: await fetchSeatable(base) });
  }
  const groups = [...seatableGroups, ...STATIC_SOURCES];
  const rows = mergeEntries(groups);
  await writeToD1(env.DB, rows);
  return rows.length;
}

// 仅用静态历史源填充 D1（不拉 SeaTable），供本地开发在无 token 时验证搜索。
export async function seedStaticOnly(env: Env): Promise<number> {
  const rows = mergeEntries(STATIC_SOURCES);
  await writeToD1(env.DB, rows);
  return rows.length;
}
