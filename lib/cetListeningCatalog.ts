import listening from "../data/cet/listening/catalog.json";
import type { CetPaper, CetSection } from "../types/cet";
export const cetListeningMetadata = listening as { paperId: string; section: CetSection }[];
export function withCetListeningMetadata(papers: CetPaper[]): CetPaper[] {
  return papers.map(paper => {
    const extra = cetListeningMetadata.find(item => item.paperId === paper.id);
    return extra ? { ...paper, sections: [extra.section, ...paper.sections.filter(s => s.type !== "listening")] } : paper;
  });
}
