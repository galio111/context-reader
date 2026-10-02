import type { CetPaper } from "../types/cet";
import { cetUnderlineSource, type CetUnderlineRange } from "./cetUnderlines";

export function readCetUnderlineSelection(root: HTMLElement, range: Range, paper: CetPaper, sectionId: string): CetUnderlineRange[] {
  const ranges: CetUnderlineRange[] = [];
  const doc = root.ownerDocument;
  for (const part of root.querySelectorAll<HTMLElement>("[data-cet-part-start]")) {
    if (!range.intersectsNode(part)) continue;
    const paragraph = part.closest<HTMLElement>("[data-cet-paragraph]");
    const questionText = part.closest<HTMLElement>("[data-cet-mark-target]");
    const paragraphIndex = paragraph ? Number(paragraph.dataset.cetParagraph) : 0;
    const partStart = Number(part.dataset.cetPartStart);
    if ((!paragraph && !questionText) || !Number.isInteger(paragraphIndex) || !Number.isInteger(partStart)) continue;
    const target = questionText?.dataset.cetMarkTarget as CetUnderlineRange["target"];
    const questionNumber = questionText?.dataset.cetQuestionNumber ? Number(questionText.dataset.cetQuestionNumber) : undefined;
    const optionKey = questionText?.dataset.cetOptionKey;
    const partRange = doc.createRange(); partRange.selectNodeContents(part);
    const intersection = range.cloneRange();
    if (intersection.compareBoundaryPoints(Range.START_TO_START, partRange) < 0) intersection.setStart(part, 0);
    if (intersection.compareBoundaryPoints(Range.END_TO_END, partRange) > 0) intersection.setEnd(part, part.childNodes.length);
    if (intersection.collapsed) continue;
    const before = doc.createRange(); before.selectNodeContents(part);
    before.setEnd(intersection.startContainer, intersection.startOffset);
    const start = partStart + before.toString().length;
    const end = start + intersection.toString().length;
    const candidate: CetUnderlineRange = { sectionId, target, questionNumber, optionKey, paragraphIndex, start, end };
    if (end > start && cetUnderlineSource(paper, candidate)?.slice(start, end).trim()) ranges.push(candidate);
  }
  return ranges.length <= 24 && ranges.reduce((length, item) => length + item.end - item.start, 0) <= 2000 ? ranges : [];
}

type Rect = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;
export function cetUnderlineMenuPosition(rects: Rect[], width: number, height: number, backwards = false) {
  const visible = rects.filter(rect => rect.width > 0 && rect.height > 0 && rect.bottom > 8 && rect.top < height - 8 && rect.right > 0 && rect.left < width);
  const rect = backwards ? visible[0] : visible[visible.length - 1];
  if (!rect) return null;
  return {
    left: Math.max(8, Math.min(width - 288, backwards ? rect.left : rect.right - 280)),
    top: Math.max(8, Math.min(height - 58, rect.top >= 66 ? rect.top - 58 : rect.bottom + 8)),
  };
}
