import { STATIC_SOURCES } from "./data/static";
import { fetchSeatable, njuTableBase, fork25Base } from "./seatable";
import { mergeEntries, type ReviewRow } from "./merge";
import type { Env } from "./index";

const ROWS_PER_STMT = 11; // 9列 × 11行 = 99绑定参数 (D1限制最多100个)
const STMTS_PER_BATCH = 50; // 每个 batch 的语句数

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// 写入暂存表，原子替换至正式表并重建 FTS
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
  ]);
}

// 刷新数据：拉取 SeaTable、合并静态数据、更新 D1
export async function refresh(env: Env): Promise<number> {
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

// 仅使用静态数据填充 D1
export async function seedStaticOnly(env: Env): Promise<number> {
  const rows = mergeEntries(STATIC_SOURCES);
  await writeToD1(env.DB, rows);
  return rows.length;
}
