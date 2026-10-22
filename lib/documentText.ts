import type { ImportedArticleBlock } from "@/types/article";
export interface PdfTextItem { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean }

// PDF content streams normally preserve column order. Group geometrically continuous
// lines only; never sort every glyph by y, which interleaves newspaper columns.
export function pdfPageBlocks(items: PdfTextItem[], page: number): ImportedArticleBlock[] {
  const lines: { text: string; x: number; y: number; height: number; right: number }[] = [];
  let line: typeof lines[number] | undefined;
  for (const item of items) {
    const [x, y] = item.transform.slice(4);
    if (!item.str.trim()) { if (line && item.str) line.text += " "; continue; }
    const height = Math.abs(item.height) || Math.hypot(item.transform[2], item.transform[3]) || 10;
    if (!line || Math.abs(line.y - y) > Math.max(line.height * .8, height * .8, 4) || x < line.x - 10 || x - line.right > 35) {
      line = { text: item.str, x, y, height, right: x + item.width }; lines.push(line);
    } else {
      const gap = x - line.right;
      line.text += (gap > height * .12 && !line.text.endsWith(" ") ? " " : "") + item.str;
      line.right = Math.max(line.right, x + item.width);
    }
  }
  const blocks: ImportedArticleBlock[] = [];
  let previous: typeof lines[number] | undefined;
  for (const row of lines) {
    const text = row.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const gap = previous ? previous.y - row.y : 0;
    const continuation = previous && gap > 0 && gap < Math.max(previous.height, row.height) * 1.8
      && Math.abs(row.x - previous.x) < 20 && Math.abs(row.height - previous.height) < 2
      && !/^[A-Z\s]{5,}$/.test(text) && row.x - previous.x < 6;
    const last = blocks.at(-1);
    if (continuation && last && (last.text?.length ?? 0) + text.length < 3500) {
      last.text = /[a-z]-$/.test(last.text ?? "") && /^[a-z]/.test(text) && !/^(?:resistant|negative|positive|dependent|induced|responsive|activated|targeting|functionalized)\b/.test(text)
        ? last.text!.slice(0, -1) + text : last.text + " " + text;
    } else blocks.push({ id: `doc-p${page}-b${blocks.length}`, type: "paragraph", text });
    previous = row;
  }
  return blocks;
}
