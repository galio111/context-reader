import type { ImportedArticleBlock } from "@/types/article";

export type DocumentTranslationScope = "body" | "captions";
const pageOf = (id: string) => Number(id.match(/^doc-p(\d+)-/)?.[1] ?? 1);
const normalized = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
const caption = /^(?:(?:fig(?:ure)?\.?|scheme|table)\s*[A-Z]?\d+|图\s*\d+|表\s*\d+)\b/i;
const start = /^(?:(?:abstract|introduction)\b|(?:摘要|引言)(?:\s|[:：]))/i;
const end = /^(?:(?:references|bibliography)(?:\s*$|\s+\[?\d)|(?:acknowledg(?:e)?ments?|author contributions?|conflicts? of interest|supplementary information)\b|参考文献|致谢)/i;
const furniture = /^(?:©|copyright\b|all rights reserved|https?:\/\/|doi\s*:|keywords?\s*:|corresponding author|\*\s*corresponding|[†‡*]\s*(?:equally|these authors)|received\s+\d|accepted\s+\d|published online\b)|^(?:\d{1,5}|[ivxlcdm]{1,6})$/i;
const affiliation = /^(?:\d+\s+)?(?:school of|department of|faculty of|institute of|national engineering|\w+ provincial key laboratory|center for|centre for|medical research center)\b/i;

/** Reading targets only: never changes source pages, saved blocks or their IDs.
 * Repeated page furniture and scientific front/back matter are excluded. Prose
 * without academic section markers keeps its content instead of requiring them. */
export function documentReadingContent(blocks: ImportedArticleBlock[]) {
  const repeated = new Map<string, Set<number>>();
  for (const b of blocks) {
    const text = normalized(b.text ?? "");
    if (text.length > 140) continue;
    const pages = repeated.get(text) ?? new Set<number>(); pages.add(pageOf(b.id)); repeated.set(text, pages);
  }
  const firstBody = blocks.findIndex(b => start.test(b.text?.trim() ?? ""));
  const scholarly = firstBody >= 0;
  const body: ImportedArticleBlock[] = [], captions: ImportedArticleBlock[] = [];
  let backMatter = false, affiliationPage = 0;
  for (const [index, block] of blocks.entries()) {
    const text = block.text?.trim() ?? "", page = pageOf(block.id);
    if (!text || block.type === "image") continue;
    if (scholarly && index < firstBody) continue;
    if (scholarly && (end.test(text) || /^received\s+\d.*(?:accepted|published)/i.test(text))) backMatter = true;
    // Some journal reference lists have no heading. Require author-style entries
    // near the end, rather than mistaking numbered methods for references.
    if (scholarly && index > blocks.length / 2 && /^\[?1\]?\s+[A-Z][\p{L}'-]+\s+[A-Z]{1,4}[,\s].*(?:et al\.|\b(?:19|20)\d{2}\b)/u.test(text)) backMatter = true;
    if (backMatter) continue;
    if (furniture.test(text) || (repeated.get(normalized(text))?.size ?? 0) >= 3) continue;
    if (scholarly && page === pageOf(blocks[firstBody].id) && affiliation.test(text)) affiliationPage = page;
    if (affiliationPage === page) continue;
    if ((caption.test(text) && !/^(?:fig(?:ure)?\.?|scheme|table)\s*\d+\s+(?:shows|illustrates|demonstrates|indicates|suggests)\b/i.test(text)) || block.type === "caption") { captions.push(block); continue; }
    // Keep short section headings; only remove isolated chart labels/numbers.
    if (text.length < 3 && !/[\p{L}]{2}/u.test(text)) continue;
    body.push(block);
  }
  return { body, captions, excludedCount: blocks.length - body.length - captions.length };
}
