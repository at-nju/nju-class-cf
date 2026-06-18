// 全程唯一的数据结构：adapters 归一后的输出，贯穿去重、写库、搜索、前端。
// 一条评价 = 一个 Entry；同一评价多来源时合并 sources。
export interface Entry {
  course: string | null;
  teacher: string | null;
  review: string; // 单条评价原文
  sources: string[];
}
