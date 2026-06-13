// 静态历史数据源（由 convert.py 从 xlsx 离线转出，手动更新后替换这些 JSON）。
// 这些源没有逐条 "来源" 字段，因此合并时用文件名作为兜底来源，与原 merge_json_files 行为一致。
import nanxiaobao from "./南小宝.json";
import oldList from "./旧红黑榜.json";
import list2024 from "./红黑榜_2024.json";
import list2023 from "./2023级本科生红黑榜.json";

export interface RawEntry {
  课程名称?: string | null;
  教师?: string | null;
  来源?: string | string[];
  [key: string]: unknown; // 评价_0, 评价_1, ... 以及其它列
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
