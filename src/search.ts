// 分层模糊搜索：精确 → 前缀 → 子串(FTS5 trigram) → 拼音全拼 → 拼音首字母 → 子序列兜底。
// 各层在一次 db.batch 中并发执行，按 id 去重保留最优层级，再按 (层级, id) 排序。

export type Field = "teacher" | "course";

interface DbRow {
  id: number;
  course: string | null;
  teacher: string | null;
  sources: string | null; // JSON 数组字符串
  review: string | null;
}

const SELECT = "SELECT id, course, teacher, sources, review FROM reviews";
const PER_TIER_LIMIT = 300;

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

function toOutput(row: DbRow): Record<string, unknown> {
  const out: Record<string, unknown> = { 课程名称: row.course, 教师: row.teacher };
  out["来源"] = row.sources ? JSON.parse(row.sources) : [];
  if (row.review != null) out["评价_0"] = row.review;
  return out;
}

export async function search(
  db: D1Database,
  field: Field,
  query: string,
): Promise<Record<string, unknown>[]> {
  const col = field; // reviews.teacher / reviews.course
  const pyCol = `${field}_py`;
  const initCol = `${field}_initials`;

  const esc = likeEscape(query);
  const chars = [...query];
  const normPy = query.toLowerCase().replace(/\s+/g, "");
  const isRomanized = /^[a-z]+$/.test(normPy); // 纯字母 → 视为拼音输入

  const tiers: { tier: number; stmt: D1PreparedStatement }[] = [];

  // 1. 精确
  tiers.push({ tier: 1, stmt: db.prepare(`${SELECT} WHERE ${col} = ? LIMIT ${PER_TIER_LIMIT}`).bind(query) });

  // 2. 前缀
  tiers.push({
    tier: 2,
    stmt: db.prepare(`${SELECT} WHERE ${col} LIKE ? ESCAPE '\\' LIMIT ${PER_TIER_LIMIT}`).bind(esc + "%"),
  });

  // 3. 子串：≥3 字符走 FTS5 trigram，否则退化为 LIKE '%q%'
  if (chars.length >= 3) {
    const phrase = query.replace(/"/g, '""');
    tiers.push({
      tier: 3,
      stmt: db
        .prepare(
          `SELECT r.id, r.course, r.teacher, r.sources, r.review
             FROM reviews_fts f JOIN reviews r ON r.id = f.rowid
            WHERE reviews_fts MATCH ? LIMIT ${PER_TIER_LIMIT}`,
        )
        .bind(`${col} : "${phrase}"`),
    });
  } else {
    tiers.push({
      tier: 3,
      stmt: db
        .prepare(`${SELECT} WHERE ${col} LIKE ? ESCAPE '\\' LIMIT ${PER_TIER_LIMIT}`)
        .bind("%" + esc + "%"),
    });
  }

  // 4 & 5. 拼音（仅当输入为纯字母时；中文输入与拼音列天然不匹配，跳过以省开销）
  if (isRomanized) {
    const escPy = likeEscape(normPy);
    tiers.push({
      tier: 4,
      stmt: db
        .prepare(`${SELECT} WHERE ${pyCol} LIKE ? ESCAPE '\\' LIMIT ${PER_TIER_LIMIT}`)
        .bind("%" + escPy + "%"),
    });
    // 首字母按 token 前缀匹配（token 以空格分隔），等价原 initials.startswith(q)
    tiers.push({
      tier: 5,
      stmt: db
        .prepare(
          `${SELECT} WHERE ${initCol} LIKE ? ESCAPE '\\' OR ${initCol} LIKE ? ESCAPE '\\' LIMIT ${PER_TIER_LIMIT}`,
        )
        .bind(escPy + "%", "% " + escPy + "%"),
    });
  }

  // 6. 子序列兜底（保留原 .*join 的宽松召回），≥2 字符才用，避免单字命中过宽
  if (chars.length >= 2) {
    const subseq = "%" + chars.map(likeEscape).join("%") + "%";
    tiers.push({
      tier: 6,
      stmt: db.prepare(`${SELECT} WHERE ${col} LIKE ? ESCAPE '\\' LIMIT ${PER_TIER_LIMIT}`).bind(subseq),
    });
  }

  const results = await db.batch<DbRow>(tiers.map((t) => t.stmt));

  // 按 id 去重，保留命中的最低层级
  const best = new Map<number, { tier: number; row: DbRow }>();
  results.forEach((res, i) => {
    const tier = tiers[i].tier;
    for (const row of res.results) {
      const cur = best.get(row.id);
      if (!cur || tier < cur.tier) best.set(row.id, { tier, row });
    }
  });

  return [...best.values()]
    .sort((a, b) => a.tier - b.tier || a.row.id - b.row.id)
    .map((m) => toOutput(m.row));
}
