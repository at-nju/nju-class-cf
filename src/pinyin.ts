import { pinyin } from "pinyin-pro";

// 教师/课程名分隔符
export const NAME_SPLIT = /[；;，,\s、]+/;

export interface PinyinFields {
  py: string; // 全拼（空格分隔）
  initials: string; // 首字母（空格分隔）
}

// 计算字符串的全拼和首字母
export function buildPinyin(name: string | null | undefined): PinyinFields {
  if (!name) return { py: "", initials: "" };
  const tokens = name.split(NAME_SPLIT).filter(Boolean);
  const pys: string[] = [];
  const inits: string[] = [];
  for (const t of tokens) {
    const full = pinyin(t, { toneType: "none", type: "array" }).join("").toLowerCase();
    const first = pinyin(t, { pattern: "first", toneType: "none", type: "array" })
      .join("")
      .toLowerCase();
    if (full) pys.push(full);
    if (first) inits.push(first);
  }
  return { py: pys.join(" "), initials: inits.join(" ") };
}
