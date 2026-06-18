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
