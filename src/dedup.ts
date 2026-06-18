import type { Entry } from "./entry";

// 统一去重：按 (course, teacher, review) 去重，同一三元组多来源则合并 sources（去重保序）。
// 丢弃既无课程又无老师、或评价为空的条目。
export function dedup(entries: Entry[]): Entry[] {
  const unique = new Map<string, Entry>();

  for (const entry of entries) {
    const { course, teacher, review } = entry;
    if (!course && !teacher) continue;
    if (!review) continue;

    const key = `${course ?? ""} ${teacher ?? ""} ${review}`;
    const existing = unique.get(key);
    if (existing) {
      for (const s of entry.sources) {
        if (!existing.sources.includes(s)) existing.sources.push(s);
      }
      continue;
    }
    unique.set(key, { course, teacher, review, sources: [...entry.sources] });
  }

  return [...unique.values()];
}
