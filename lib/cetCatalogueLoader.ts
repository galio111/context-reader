import type { CetPaper } from "../types/cet";
export interface CetCataloguePage { papers: CetPaper[]; total: number; years: number[] }
/** Fetch metadata only. Previously visible pages survive a later-page failure. */
export async function loadCetCatalogue(options: {
  signal: AbortSignal;
  initial?: CetPaper[];
  fetchPage: (page: number, signal: AbortSignal) => Promise<CetCataloguePage>;
  onBatch: (page: CetCataloguePage) => void;
}) {
  let papers = [...(options.initial || [])];
  for (let page = Math.floor(papers.length / 12); page <= 100; page++) {
    const batch = await options.fetchPage(page, options.signal);
    if (options.signal.aborted) return;
    const byId = new Map(papers.map(paper => [paper.id, paper]));
    for (const paper of batch.papers) byId.set(paper.id, paper);
    const previousCount = papers.length;
    papers = [...byId.values()];
    options.onBatch({ ...batch, papers });
    if (papers.length >= batch.total) return;
    if (papers.length === previousCount || !batch.papers.length) throw new Error("目录返回不完整，请重试。");
  }
  throw new Error("目录过大，请重试。");
}
