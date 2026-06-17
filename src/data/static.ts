// 静态历史数据源
import nanxiaobao from "./南小宝.json";
import oldList from "./旧红黑榜.json";
import list2024 from "./红黑榜_2024.json";
import list2023 from "./2023级本科生红黑榜.json";

export interface RawEntry {
  课程名称?: string | null;
  教师?: string | null;
  来源?: string | string[];
  [key: string]: unknown; // 评价等额外字段
}

export interface SourceGroup {
  fallbackSource: string;
  entries: RawEntry[];
}

export const STATIC_SOURCES: SourceGroup[] = [
  { fallbackSource: "南小宝.json", entries: nanxiaobao as RawEntry[] },
  { fallbackSource: "旧红黑榜.json", entries: oldList as RawEntry[] },
  { fallbackSource: "红黑榜_2024.json", entries: list2024 as RawEntry[] },
  { fallbackSource: "2023级本科生红黑榜.json", entries: list2023 as RawEntry[] },
];
