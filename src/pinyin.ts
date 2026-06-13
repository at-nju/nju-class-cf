import { pinyin } from "pinyin-pro";

// 与原 app.py 一致的教师/课程名分隔符
export const NAME_SPLIT = /[；;，,\s、]+/;

export interface PinyinFields {
  py: string; // 全拼，各 token 以空格分隔，如 "zhangsan lisi"
  initials: string; // 首字母，各 token 以空格分隔，如 "zs ls"
}

// 对一个可能包含多名（教师）或多段（课程）的字符串，按 token 计算全拼与首字母。
// 非中文字符 pinyin-pro 原样返回，因此英文/数字也能进入索引。
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
