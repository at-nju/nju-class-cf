import type { RawEntry } from "./data/static";

const SERVER_URL = "https://table.nju.edu.cn";

// SeaTable base 接入配置
export interface SeatableBase {
  apiToken: string;
  // 解析某子表的目标列名，返回 null 表示跳过
  resolveColumns: (tableName: string, columns: string[]) => [string, string] | null;
  sourceLabel: (tableName: string) => string;
}

const NJU_TABLE_ROW_NAMES: Record<string, [string, string]> = {
  "2025": ["课程", "授课老师"],
  "2024": ["课程", "授课老师"],
  "2022": ["课程", "老师"],
  "2021": ["课程名", "任课老师"],
  "2020": ["课程", "老师"],
};

// NJU Table 映射规则：按年份前缀匹配，跳过 2023
export function njuTableBase(apiToken: string): SeatableBase {
  return {
    apiToken,
    resolveColumns: (tableName) => {
      if (!/^\d{4}/.test(tableName)) return null;
      if (tableName.startsWith("2023")) return null;
      return NJU_TABLE_ROW_NAMES[tableName.slice(0, 4)] ?? null;
    },
    sourceLabel: (tableName) => `NJU Table - ${tableName}`,
  };
}

// fork25 映射规则：基于列名前缀匹配
export function fork25Base(apiToken: string): SeatableBase {
  return {
    apiToken,
    resolveColumns: (tableName, columns) => {
      if (!/^\d{4}/.test(tableName)) return null;
      const courseCol = columns.find((c) => c.startsWith("课程"));
      const teacherCol = columns.find((c) => c.startsWith("老师"));
      if (!courseCol || !teacherCol) return null;
      return [courseCol, teacherCol];
    },
    sourceLabel: (tableName) => `fork25 - ${tableName}`,
  };
}

interface AppAccessToken {
  access_token: string;
  dtable_uuid: string;
  dtable_server: string;
  use_api_gateway?: boolean;
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
  // 获取 API 请求根路径
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

// 分页拉取子表所有行
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
    url.searchParams.set("convert_keys", "true"); // 使用列名作为 key
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

// 获取 SeaTable 数据并归一化
export async function fetchSeatable(base: SeatableBase): Promise<RawEntry[]> {
  const token = await authenticate(base.apiToken);
  const metadata = await getMetadata(token);
  const tables: any[] = metadata.tables ?? [];

  const result: RawEntry[] = [];
  for (const table of tables) {
    const tableName: string = table.name;
    const colNames: string[] = (table.columns ?? []).map((c: any) => c.name);
    const mapping = base.resolveColumns(tableName, colNames);
    if (!mapping) continue;
    const [courseCol, teacherCol] = mapping;

    const rows = await listRows(token, tableName);
    if (rows.length === 0) continue;
    // 校验所需列是否存在
    if (!(courseCol in rows[0]) || !(teacherCol in rows[0])) continue;

    for (const row of rows) {
      if (!row[courseCol] && !row[teacherCol]) continue;
      if ("额外标签" in row && row["额外标签"] === "允许额外补充标签") continue;

      const entry: RawEntry = {
        课程名称: row[courseCol],
        教师: row[teacherCol],
        来源: base.sourceLabel(tableName),
      };
      // 提取并整理所有评价列
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
