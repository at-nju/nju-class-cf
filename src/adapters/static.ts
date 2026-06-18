// 静态历史数据源（src/data/*.json，原始格式带 评价_N 编号键）
import nanxiaobao from "../data/南小宝.json";
import oldList from "../data/旧红黑榜.json";
import list2024 from "../data/红黑榜_2024.json";
import list2023 from "../data/2023级本科生红黑榜.json";
import type { Entry } from "../entry";
import { extractReviews } from "./extract";

// 静态 JSON adapter：每条评价归一成一个 Entry
function jsonAdapter(rows: unknown[], source: string): Entry[] {
  const result: Entry[] = [];
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    const course = (row["课程名称"] as string | null | undefined) ?? null;
    const teacher = (row["教师"] as string | null | undefined) ?? null;
    if (!course && !teacher) continue;
    for (const review of extractReviews(row)) {
      result.push({ course, teacher, review, sources: [source] });
    }
  }
  return result;
}

// 全部静态源归一成 Entry[]
export function loadStatic(): Entry[] {
  return [
    ...jsonAdapter(nanxiaobao as unknown[], "南小宝.json"),
    ...jsonAdapter(oldList as unknown[], "旧红黑榜.json"),
    ...jsonAdapter(list2024 as unknown[], "红黑榜_2024.json"),
    ...jsonAdapter(list2023 as unknown[], "2023级本科生红黑榜.json"),
  ];
}
