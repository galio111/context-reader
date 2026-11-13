import { getSentenceSpans } from "../../lib/tokenizer.ts";
const WORD = /^[A-Za-z]+(?:['’-][A-Za-z]+)*(?:\s+[A-Za-z]+(?:['’-][A-Za-z]+)*){0,7}$/;
const BLOCKS = new Set(["P", "LI", "BLOCKQUOTE", "TD", "TH", "H1", "H2", "H3", "H4", "PRE", "DIV", "ARTICLE", "SECTION"]);
export function validWord(text) { return typeof text === "string" && WORD.test(text.trim()) && text.trim().length <= 160; }
export function sentenceContext(text, start, end, word) {
  const boundaries = text.replace(/\b(?:figs?|eqs?|refs?|secs?|tabs?)\.(?=\s*(?:[[(]\s*)?(?:[a-z]\s*)?\d)/gi, a => a.slice(0, -1) + "·");
  const segments = getSentenceSpans(boundaries).map(v => ({ ...v, text: text.slice(v.start, v.end).trim() }));
  const first = segments.findIndex(v => v.end > start), last = segments.findIndex(v => v.end >= end);
  const sentence = first >= 0 && last >= first ? segments.slice(first, last + 1).map(v => v.text).join(" ") : "";
  const comparable = v => v.replace(/’/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  const hasContext = sentence.length <= 5000 && comparable(sentence).includes(comparable(word)) && comparable(sentence) !== comparable(word);
  return { word, sentence: hasContext ? sentence : "", previousSentence: hasContext ? segments[first - 1]?.text.slice(-3000) || "" : "", nextSentence: hasContext ? segments[last + 1]?.text.slice(0, 3000) || "" : "" };
}
export function extractSelection(document) {
  const selection = document.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0), selectedText = selection.toString(), word = selectedText.trim().replace(/’/g, "'").replace(/\s+/g, " ");
  if (!validWord(word)) return null;
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
      const first = entries.find(v => v.node === range.startContainer), last = entries.find(v => v.node === range.endContainer);
      if (first && last) {
        const start = first.start + range.startOffset + (selectedText.match(/^\s*/)?.[0].length || 0);
        const end = last.start + range.endOffset - (selectedText.match(/\s*$/)?.[0].length || 0);
        context = sentenceContext(text, start, end, word);
      }
    } catch {}
  }
  const rect = range.getBoundingClientRect();
  return { ...context, pageTitle: document.title.slice(0, 200), pageUrl: document.location.href.split("#")[0].slice(0, 2000), rect: { left: rect.left, bottom: rect.bottom, top: rect.top, right: rect.right } };
}
