import type { ImportedArticleBlock } from "@/types/article";

export type DocumentTranslationScope = "body" | "captions";
const pageOf = (id: string) => Number(id.match(/^doc-p(\d+)-/)?.[1] ?? 1);
const normalized = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
const caption = /^(?:(?:fig(?:ure)?\.?|scheme|table)\s*[A-Z]?\d+|图\s*\d+|表\s*\d+)\b/i;
const start = /^(?:(?:abstract|introduction)\b|(?:摘要|引言)(?:\s|[:：]))/i;
const end = /^(?:(?:references|bibliography)(?:\s*$|\s+\[?\d)|(?:acknowledg(?:e)?ments?|author contributions?|conflicts? of interest|supplementary information)\b|参考文献|致谢)/i;
const furniture = /^(?:©|copyright\b|all rights reserved|https?:\/\/|doi\s*:|keywords?\s*:|corresponding author|\*\s*corresponding|[†‡*]\s*(?:equally|these authors)|received\s+\d|accepted\s+\d|published online\b)|^(?:\d{1,5}|[ivxlcdm]{1,6})$/i;
const affiliation = /^(?:\d+\s+)?(?:school of|college of|department of|faculty of|institute of|national engineering|\w+ provincial key laboratory|center for|centre for|medical research center)\b/i;

/** Reading targets only: never changes source pages, saved blocks or their IDs.
 * Repeated page furniture and scientific front/back matter are excluded. Prose
 * without academic section markers keeps its content instead of requiring them. */
export function documentReadingContent(blocks: ImportedArticleBlock[]) {
  // Rotated/landscape tables often extract as hundreds of tiny cells. Only
  // suppress whole pages when BOTH an explicit continued-table marker and a
  // predominantly fragmented layout are present; never infer this from size alone.
  const pages = new Map<number, ImportedArticleBlock[]>();
  for (const block of blocks) {
    const page = pageOf(block.id);
    pages.set(page, [...(pages.get(page) ?? []), block]);
  }
  const tableOnlyPages = new Set<number>();
  for (const [page, items] of pages) {
    const texts = items.map(b => b.text?.trim() ?? "").filter(Boolean);
    if (texts.length >= 30
      && texts.some(t => /^table\s*\d+\b/i.test(t))
      && texts.some(t => /^\(?continued?s?\)?$/i.test(t))
      && texts.filter(t => t.length < 160).length / texts.length > 0.9
      && !texts.some(t => t.length > 500)) tableOnlyPages.add(page);
  }
  const repeated = new Map<string, Set<number>>();
  for (const b of blocks) {
    const text = normalized(b.text ?? "");
    if (text.length > 140) continue;
    const pages = repeated.get(text) ?? new Set<number>(); pages.add(pageOf(b.id)); repeated.set(text, pages);
  }
  const firstBody = blocks.findIndex(b => start.test(b.text?.trim() ?? ""));
  const hasLabelledAbstract = firstBody >= 0 && /^(?:abstract\b|摘要)/i.test(blocks[firstBody].text?.trim() ?? "");
  const scholarly = firstBody >= 0;
  const body: ImportedArticleBlock[] = [], captions: ImportedArticleBlock[] = [];
  let backMatter = false, affiliationPage = 0, tablePage = 0;
  for (const [index, block] of blocks.entries()) {
    const text = block.text?.trim() ?? "", page = pageOf(block.id);
    if (!text || block.type === "image") continue;
    if (tableOnlyPages.has(page)) {
      if (/^table\s*\d+\b/i.test(text) && text.length > 12) captions.push(block);
      continue;
    }
    // Some journals use an unlabelled abstract before Introduction.
    if (scholarly && index < firstBody && (hasLabelledAbstract || text.length < 240 || affiliation.test(text))) continue;
    if (scholarly && index > firstBody && (end.test(text) || index > blocks.length / 2 && page > pageOf(blocks[firstBody].id) && /^received\s+\d.*accepted/i.test(text))) backMatter = true;
    // Some journal reference lists have no heading. Require author-style entries
    // near the end, rather than mistaking numbered methods for references.
    if (scholarly && index > blocks.length / 2 && /^\[?1\]?\s+[A-Z][\p{L}'-]+\s+[A-Z]{1,4}[,\s].*(?:et al\.|\b(?:19|20)\d{2}\b)/u.test(text)) backMatter = true;
    if (backMatter) continue;
    if (text.length < 160 && /(?:19|20)\d{2}/.test(text) && (/^\d+\s*\|/.test(text) || /\|\s*\d+$/.test(text))) continue;
    if (tablePage === page && text.length < 160 && !/^(?:results|discussion|conclusions?|methods|experimental)\b/i.test(text)) continue;
    tablePage = 0;
    if (/^(?:Cite this:|This journal is|Licence and permissions|Published on |rsc\.li\/)/i.test(text)
      || /^\d{5,}.*Downloaded from https?:\/\/.*(?:Terms and Conditions|Online Library)/i.test(text)
      || furniture.test(text) || (repeated.get(normalized(text))?.size ?? 0) >= 3) continue;
    if (scholarly && affiliation.test(text)) { affiliationPage = page; continue; }
    if (affiliationPage === page && text.length < 140 && !/[.!?]$/.test(text)) continue;
    affiliationPage = 0;
    if ((caption.test(text) && !/^(?:fig(?:ure)?\.?|scheme|table)\s*\d+\s+(?:shows|illustrates|demonstrates|indicates|suggests)\b/i.test(text)) || block.type === "caption") { captions.push(block); if (/^table\s*\d+/i.test(text)) tablePage = page; continue; }
    // Keep short section headings; only remove isolated chart labels/numbers.
    if ((text.match(/[A-Za-z]{3,}/g)?.length ?? 0) < 2 && /\d/.test(text) && text.length < 100) continue;
    if (text.length < 3 && !/[\p{L}]{2}/u.test(text)) continue;
    body.push(block);
  }
  return { body, captions, excludedCount: blocks.length - body.length - captions.length };
}
