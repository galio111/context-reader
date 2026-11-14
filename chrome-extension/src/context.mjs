import { getSentenceSpans } from "../../lib/tokenizer.ts";
import { extensionSelectionMode, completeExtensionSelection } from "../../lib/browserExtensionSelection.ts";
const BLOCKS = new Set(["P", "LI", "BLOCKQUOTE", "TD", "TH", "H1", "H2", "H3", "H4", "PRE", "DIV", "ARTICLE", "SECTION"]);
export function validWord(text) { return extensionSelectionMode(text) === "word"; }
export function sentenceContext(text, start, end, word) {
  const boundaries = text.replace(/\b(?:figs?|eqs?|refs?|secs?|tabs?)\.(?=\s*(?:[[(]\s*)?(?:[a-z]\s*)?\d)/gi, a => a.slice(0, -1) + "·");
  const segments = getSentenceSpans(boundaries).map(v => ({ ...v, text: text.slice(v.start, v.end).trim() }));
  const first = segments.findIndex(v => v.end > start), last = segments.findIndex(v => v.end >= end);
  const sentence = first >= 0 && last >= first ? segments.slice(first, last + 1).map(v => v.text).join(" ") : "";
  const comparable = v => v.replace(/[’ʼ]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  const hasContext = sentence.length <= 5000 && comparable(sentence).includes(comparable(word)) && comparable(sentence) !== comparable(word);
  return { word, sentence: hasContext ? sentence : "", previousSentence: hasContext ? segments[first - 1]?.text.slice(-3000) || "" : "", nextSentence: hasContext ? segments[last + 1]?.text.slice(0, 3000) || "" : "" };
}
export function extractSelection(document) {
  const selection = document.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0), selectedText = selection.toString();
  if (!selectedText.trim() || selectedText.length > 5000) return null;
  let mode = extensionSelectionMode(selectedText);
  let word = mode === "word" ? selectedText.trim().replace(/[’ʼ]/g, "'").replace(/\s+/g, " ") : selectedText.trim();
  let anchorRange = range;
  let el = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  if (el?.closest("input, textarea, [contenteditable]:not([contenteditable='false']), [data-context-reader-extension]")) return null;
  while (el?.parentElement && !BLOCKS.has(el.tagName)) el = el.parentElement;
  let context = { word, sentence: "", previousSentence: "", nextSentence: "" };
  if (el && el.textContent.length <= 40000) {
    try {
      const walker = document.createTreeWalker(el, 4), entries = []; let text = "";
      while (walker.nextNode()) {
        const node = walker.currentNode, parent = node.parentElement;
        if (parent?.closest("script,style,noscript,[hidden],[aria-hidden='true']")) continue;
        const style = parent && document.defaultView?.getComputedStyle(parent);
        if (style?.display === "none" || style?.visibility === "hidden") continue;
        entries.push({ node, start: text.length }); text += node.data;
      }
      const first = entries.find(v => v.node === range.startContainer) || entries.find(v => range.comparePoint(v.node, v.node.data.length) >= 0 && range.comparePoint(v.node, 0) <= 0);
      const last = entries.find(v => v.node === range.endContainer) || entries.findLast(v => range.comparePoint(v.node, 0) <= 0 && range.comparePoint(v.node, v.node.data.length) >= 0);
      if (first && last) {
        const start = first.start + (first.node === range.startContainer ? range.startOffset : 0) + (selectedText.match(/^\s*/)?.[0].length || 0);
        const end = last.start + (last.node === range.endContainer ? range.endOffset : last.node.data.length) - (selectedText.match(/\s*$/)?.[0].length || 0);
        const complete = completeExtensionSelection(text, start, end);
        mode = extensionSelectionMode(complete.text);
        if (!mode) return null;
        word = mode === "word" ? complete.text.replace(/[’ʼ]/g, "'").replace(/\s+/g, " ") : complete.text;
        context = sentenceContext(text, complete.start, complete.end, word);
        if (complete.start !== start || complete.end !== end) {
          const from = entries.find(v => v.start <= complete.start && complete.start < v.start + v.node.data.length);
          const to = entries.findLast(v => v.start < complete.end && complete.end <= v.start + v.node.data.length);
          if (from && to) {
            anchorRange = document.createRange(); anchorRange.setStart(from.node, complete.start - from.start); anchorRange.setEnd(to.node, complete.end - to.start);
            selection.removeAllRanges(); selection.addRange(anchorRange);
          }
        }
      }
    } catch {}
  }
  if (!mode) return null;
  const rect = anchorRange.getBoundingClientRect();
  return { ...context, mode, pageTitle: document.title.slice(0, 200), pageUrl: document.location.href.split("#")[0].slice(0, 2000), rect: { left: rect.left, bottom: rect.bottom, top: rect.top, right: rect.right } };
}
