import { buildPinyin } from "./pinyin";

// 全程唯一的归一结构：各 adapter 的输出，运行时只流动它。
export interface Entry {
  course: string | null;
  teacher: string | null;
  review: string; // 单条评价原文
  sources: string[];
}

// 数据库行：Entry + 写库前算出的拼音（数据库后处理，逻辑不变）
export interface ReviewRow {
  course: string | null;
  teacher: string | null;
  sources: string[];
  review: string;
  teacher_py: string;
  teacher_initials: string;
  course_py: string;
  course_initials: string;
}

// adapter 公共：从一行原始数据取出所有「评价」开头的非空文本（去首尾空白，保序）
export function extractReviews(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith("评价") && v != null) {
      const s = String(v).trim();
      if (s) out.push(s);
    }
  }
  return out;
}

// 统一处理：按 (course, teacher, review) 去重（同一评价多来源则合并 sources），再算拼音
export function mergeEntries(entries: Entry[]): ReviewRow[] {
  const unique = new Map<string, ReviewRow>();

  for (const entry of entries) {
    const { course, teacher, review } = entry;
    if (!course && !teacher) continue;

    const key = `${course ?? ""} ${teacher ?? ""} ${review}`;
    const existing = unique.get(key);
    if (existing) {
      for (const s of entry.sources) {
        if (!existing.sources.includes(s)) existing.sources.push(s);
      }
      continue;
    }

    const tp = buildPinyin(teacher);
    const cp = buildPinyin(course);
    unique.set(key, {
      course,
      teacher,
      sources: [...entry.sources],
      review,
      teacher_py: tp.py,
      teacher_initials: tp.initials,
      course_py: cp.py,
      course_initials: cp.initials,
    });
  }

  return [...unique.values()];
}
