// 分层模糊搜索：精确 -> 前缀 -> 子串 -> 拼音全拼 -> 拼音首字母 -> 子序列

export type Field = "teacher" | "course";

interface DbRow {
  id: number;
  course: string | null;
  teacher: string | null;
  sources: string | null; // JSON 数组字符串的来源列表
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
  const col = field;
  const pyCol = `${field}_py`;
  const initCol = `${field}_initials`;

  const esc = likeEscape(query);
  const chars = [...query];
  const normPy = query.toLowerCase().replace(/\s+/g, "");
  const isRomanized = /^[a-z]+$/.test(normPy); // 纯字母输入视为拼音或英文

  const tiers: { tier: number; stmt: D1PreparedStatement }[] = [];

  // 1. 精确匹配
  tiers.push({ tier: 1, stmt: db.prepare(`${SELECT} WHERE ${col} = ? LIMIT ${PER_TIER_LIMIT}`).bind(query) });

  // 2. 前缀匹配
  tiers.push({
    tier: 2,
    stmt: db.prepare(`${SELECT} WHERE ${col} LIKE ? ESCAPE '\\' LIMIT ${PER_TIER_LIMIT}`).bind(esc + "%"),
  });

  // 3. 子串匹配：>=3 字符使用 FTS5 trigram，否则退化为 LIKE '%q%'
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

  // 4 & 5. 拼音匹配（仅输入为拼音时）
  if (isRomanized) {
    const escPy = likeEscape(normPy);
    tiers.push({
      tier: 4,
      stmt: db
        .prepare(`${SELECT} WHERE ${pyCol} LIKE ? ESCAPE '\\' LIMIT ${PER_TIER_LIMIT}`)
        .bind("%" + escPy + "%"),
    });

    tiers.push({
      tier: 5,
      stmt: db
        .prepare(
          `${SELECT} WHERE ${initCol} LIKE ? ESCAPE '\\' OR ${initCol} LIKE ? ESCAPE '\\' LIMIT ${PER_TIER_LIMIT}`,
        )
        .bind(escPy + "%", "% " + escPy + "%"),
    });
  }

  // 6. 子序列匹配（>=2 字符）
  if (chars.length >= 2) {
    const subseq = "%" + chars.map(likeEscape).join("%") + "%";
    tiers.push({
      tier: 6,
      stmt: db.prepare(`${SELECT} WHERE ${col} LIKE ? ESCAPE '\\' LIMIT ${PER_TIER_LIMIT}`).bind(subseq),
    });
  }

  const results = await db.batch<DbRow>(tiers.map((t) => t.stmt));

  // 按 id 去重，保留最优匹配层级
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
