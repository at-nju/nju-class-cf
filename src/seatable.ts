import type { RawEntry } from "./data/static";

// 与原 nju_table.py 一致
const SERVER_URL = "https://table.nju.edu.cn";

// 各年份子表对应的 [课程列名, 老师列名]
const ROW_NAMES: Record<string, [string, string]> = {
  "2025": ["课程", "授课老师"],
  "2024": ["课程", "授课老师"],
  "2022": ["课程", "老师"],
  "2021": ["课程名", "任课老师"],
  "2020": ["课程", "老师"],
};

interface AppAccessToken {
  access_token: string;
  dtable_uuid: string;
  dtable_server: string; // 新版形如 https://table.nju.edu.cn/api-gateway/
  use_api_gateway?: boolean; // 新版 SeaTable 走 API Gateway（api/v2）
}

async function authenticate(apiToken: string): Promise<AppAccessToken> {
  const res = await fetch(`${SERVER_URL}/api/v2.1/dtable/app-access-token/`, {
    headers: { Authorization: `Token ${apiToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`SeaTable auth failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as AppAccessToken;
}

function apiBase(token: AppAccessToken): string {
  // dtable_server 末尾通常带 /，规范化后按是否走 API Gateway 选择 v2 / v1
  const root = token.dtable_server.replace(/\/+$/, "");
  const version = token.use_api_gateway ? "v2" : "v1";
  return `${root}/api/${version}`;
}

async function getMetadata(token: AppAccessToken): Promise<any> {
  const base = apiBase(token);
  const res = await fetch(`${base}/dtables/${token.dtable_uuid}/metadata/`, {
    headers: { Authorization: `Token ${token.access_token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`SeaTable metadata failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as any;
  return data.metadata;
}

// 分页拉取整张子表（SeaTable 单次最多 1000 行，原 Python SDK 自动翻页，这里手动实现）
async function listRows(token: AppAccessToken, tableName: string): Promise<any[]> {
  const base = apiBase(token);
  const limit = 1000;
  let start = 0;
  const all: any[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url = new URL(`${base}/dtables/${token.dtable_uuid}/rows/`);
    url.searchParams.set("table_name", tableName);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("start", String(start));
    url.searchParams.set("convert_keys", "true"); // 返回以列名（课程/老师/评价N）为键，而非列 key
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Token ${token.access_token}`, Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`SeaTable list_rows(${tableName}) failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as any;
    const rows: any[] = data.rows ?? [];
    all.push(...rows);
    if (rows.length < limit) break;
    start += limit;
  }
  return all;
}

// 端口自 nju_table.fetch_data：拉取所有以 4 位年份开头的子表，跳过 2023。
export async function fetchSeatable(apiToken: string): Promise<RawEntry[]> {
  const token = await authenticate(apiToken);
  const metadata = await getMetadata(token);
  const tables: any[] = metadata.tables ?? [];

  const result: RawEntry[] = [];
  for (const table of tables) {
    const tableName: string = table.name;
    if (!/^\d{4}/.test(tableName)) continue;
    if (tableName.startsWith("2023")) continue;

    const year = tableName.slice(0, 4);
    const mapping = ROW_NAMES[year];
    if (!mapping) continue; // 未知年份子表跳过（原代码会 KeyError，这里安全跳过）
    const [courseCol, teacherCol] = mapping;

    const rows = await listRows(token, tableName);
    if (rows.length === 0) continue;
    // 与原逻辑一致：用首行判断该子表是否含所需列
    if (!(courseCol in rows[0]) || !(teacherCol in rows[0])) continue;

    for (const row of rows) {
      if (!row[courseCol] && !row[teacherCol]) continue;
      if ("额外标签" in row && row["额外标签"] === "允许额外补充标签") continue;

      const entry: RawEntry = {
        课程名称: row[courseCol],
        教师: row[teacherCol],
        来源: `NJU Table - ${tableName}`,
      };
      // 收集所有 "评价" 开头的非空列，重新编号为 评价_0, 评价_1, ...
      let cnt = 0;
      for (const key of Object.keys(row)) {
        if (key.startsWith("评价") && row[key]) {
          entry[`评价_${cnt}`] = row[key];
          cnt += 1;
        }
      }
      result.push(entry);
    }
  }
  return result;
}
