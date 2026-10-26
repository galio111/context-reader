import type { ImportedArticle } from "@/types/article";
import type { WordContext } from "@/types/reader";
import { LATIN_PHRASE_PATTERN } from "./latinWords";
import { getSentenceSpans } from "./tokenizer";
import { cleanDocumentText } from "./documentUnicode";

export function normalizeDocumentSelection(text: string): string {
  return cleanDocumentText(text).normalize("NFKC").replace(/([a-z])-\s*\n\s*([a-z]+)/g, (_, before, after) =>
    `${before}${/^(resistant|negative|positive|dependent|induced|responsive|activated|targeting|functionalized|associated|treated)\b/.test(after) ? "-" : ""}${after}`)
    .replace(/\s+/g, " ").trim();
}

export function documentSelectionMode(text: string): "ignore" | "lookup" | "translation" {
  if (!/\p{L}/u.test(text)) return "ignore";
  const words = text.match(/\p{L}[\p{L}\p{M}\d]*(?:[-'’][\p{L}\p{M}\d]+)*/gu) ?? [];
  return words.length <= 5 && LATIN_PHRASE_PATTERN.test(text) ? "lookup" : "translation";
}

export function expandDocumentWordEdges(text: string, start: number, end: number): [number, number] {
  for (const match of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:(?:[-'’]|-\s*\n\s*)[\p{L}\p{N}\p{M}]+)*/gu)) {
    const left = match.index!, right = left + match[0].length;
    if (start > left && start < right) start = left;
    if (end > left && end < right) end = right;
  }
  return [start, end];
}

/** Only deliberate native ranges: a single click never manufactures a lookup. */
export function readDocumentSelection(root: HTMLElement, article: ImportedArticle): WordContext | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const entries: { node: Text; start: number; end: number }[] = [];
  let text = "", previousLine: Element | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement?.closest("style,script,[aria-hidden=true]")) continue;
    const line = node.parentElement?.closest("[data-pdf-line],.textLayer>span,p,td,h1,h2,h3") ?? null;
    if (previousLine && line !== previousLine) text += "\n";
    previousLine = line;
    entries.push({ node, start: text.length, end: text.length + node.length });
    text += node.data;
  }
  const first = entries.find(e => e.node === range.startContainer);
  const last = entries.find(e => e.node === range.endContainer);
  if (!first || !last) return null;
  const [start, end] = expandDocumentWordEdges(text, first.start + range.startOffset, last.start + range.endOffset);
  const word = normalizeDocumentSelection(text.slice(start, end));
  if (documentSelectionMode(word) === "ignore") return null;
  const from = entries.find(e => e.start <= start && e.end > start);
  const to = entries.find(e => e.start < end && e.end >= end);
  if (from && to) {
    const expanded = root.ownerDocument.createRange();
    expanded.setStart(from.node, start - from.start); expanded.setEnd(to.node, end - to.start);
    selection.removeAllRanges(); selection.addRange(expanded);
    paintDocumentSelection(root, expanded);
  }
  const page = (first.node.parentElement?.closest("[data-document-page]") as HTMLElement | null)?.dataset.documentPage;
  const candidates = article.blocks.filter(b => !page || b.id.startsWith(`doc-p${page}-`));
  const nearby = normalizeDocumentSelection(text.slice(Math.max(0, start - 90), end + 90));
  const terms = nearby.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const matching = candidates.filter(b => normalizeDocumentSelection(b.text ?? "").toLowerCase().includes(word.toLowerCase()));
  const score = (value: string) => terms.reduce((n, term) => n + (value.toLowerCase().includes(term) ? 1 : 0), 0);
  matching.sort((a,b) => score(b.text ?? "") - score(a.text ?? ""));
  const block = matching[0];
  const index = block ? article.blocks.indexOf(block) : -1;
  const source = normalizeDocumentSelection(block?.text || text);
  // Select the actual sentence containing this occurrence, never paragraph one.
  const resolved = documentSentenceContext(source, word, nearby);
  return { word, ...resolved, paragraphIndex: index, tokenIndex: 0 };

}

export function selectDocumentWord(event: MouseEvent, root: HTMLElement, article: ImportedArticle): WordContext | null {
  const doc = root.ownerDocument;
  const hit = (event.target as Element)?.closest?.(".pdfGlyph");
  const caret = documentCaretAtPoint(root, event.clientX, event.clientY);
  const node = hit?.firstChild ?? caret?.startContainer;
  if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node) || !node.textContent?.length) return null;
  const offset = hit ? 0 : Math.min(caret!.startOffset, node.textContent.length - 1);
  const range = doc.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1);
  const selection = doc.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  return readDocumentSelection(root, article);
}

export function documentCaretAtPoint(root: HTMLElement, x: number, y: number): Range | null {
  const doc = root.ownerDocument;
  const glyph = doc.elementFromPoint(x, y)?.closest(".pdfGlyph");
  if (glyph?.firstChild && root.contains(glyph)) {
    const rect = glyph.getBoundingClientRect(), range = doc.createRange();
    range.setStart(glyph.firstChild, x < rect.left + rect.width / 2 ? 0 : glyph.firstChild.textContent!.length);
    range.collapse(true); return range;
  }
  const compatible = doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  let range = compatible.caretRangeFromPoint?.(x, y);
  if (!range) {
    const position = compatible.caretPositionFromPoint?.(x, y);
    if (position) { range = doc.createRange(); range.setStart(position.offsetNode, position.offset); range.collapse(true); }
  }
  return range && root.contains(range.startContainer) ? range : null;
}

export function setDocumentDragRange(anchor: Range, focus: Range) {
  const range = anchor.cloneRange();
  if (anchor.compareBoundaryPoints(Range.START_TO_START, focus) <= 0) range.setEnd(focus.startContainer, focus.startOffset);
  else { range.setStart(focus.startContainer, focus.startOffset); range.setEnd(anchor.startContainer, anchor.startOffset); }
  const selection = range.startContainer.ownerDocument!.getSelection();
  selection?.removeAllRanges(); selection?.addRange(range);
  const root = range.startContainer.parentElement?.closest<HTMLElement>("[data-document-selection-root]");
  if (root) paintDocumentSelection(root, range);
}

export function clearDocumentSelectionHighlight(root: HTMLElement) {
  root.querySelectorAll("[data-document-highlight]").forEach(node => node.remove());
}

function paintDocumentSelection(root: HTMLElement, selected: Range) {
  clearDocumentSelectionHighlight(root);
  for (const page of root.querySelectorAll<HTMLElement>("[data-document-page]")) {
    if (!selected.intersectsNode(page)) continue;
    const bounds = page.getBoundingClientRect();
    const scaleX = page.offsetWidth ? bounds.width / page.offsetWidth : 1;
    const scaleY = page.offsetHeight ? bounds.height / page.offsetHeight : scaleX;
    const boxes: { left: number; top: number; right: number; height: number }[] = [];
    for (const span of page.querySelectorAll<HTMLElement>(".textLayer span:not(.pdfGlyphLine)")) {
      const node = span.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE || !selected.intersectsNode(node)) continue;
      const part = root.ownerDocument.createRange(); part.selectNodeContents(node);
      if (selected.startContainer === node) part.setStart(node, selected.startOffset);
      if (selected.endContainer === node) part.setEnd(node, selected.endOffset);
      if (part.collapsed) continue;
      for (const rect of part.getClientRects()) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        const last = boxes.at(-1);
        if (last && Math.abs(last.top - rect.top) < 1 && Math.abs(last.height - rect.height) < 1 && rect.left >= last.left && rect.left - last.right < 3) last.right = rect.right;
        else boxes.push({ left: rect.left, top: rect.top, right: rect.right, height: rect.height });
      }
    }
    const overlay = root.ownerDocument.createElement("div"); overlay.dataset.documentHighlight = "";
    overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2";
    for (const box of boxes) {
      const mark = root.ownerDocument.createElement("i");
      mark.style.cssText = `position:absolute;left:${(box.left-bounds.left)/scaleX}px;top:${(box.top-bounds.top)/scaleY}px;width:${(box.right-box.left)/scaleX}px;height:${box.height/scaleY}px;background:rgba(0,102,204,.25)`;
      overlay.append(mark);
    }
    page.append(overlay);
  }
}

export function documentSentenceContext(source: string, word: string, nearby = "") {
  const spans = getSentenceSpans(source);
  const matches = spans.map((span, index) => ({ span, index }))
    .filter(({ span }) => span.text.toLowerCase().includes(word.toLowerCase()));
  const tokens = nearby.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const score = (text: string) => tokens.reduce((n, token) => n + (text.toLowerCase().includes(token) ? 1 : 0), 0);
  matches.sort((a,b) => score(b.span.text) - score(a.span.text));
  const match = matches[0];
  if (!match) return { sentence: word, previousSentence: "", nextSentence: "" };
  return { sentence: match.span.text, previousSentence: spans[match.index - 1]?.text ?? "", nextSentence: spans[match.index + 1]?.text ?? "" };
}
