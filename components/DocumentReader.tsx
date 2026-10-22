"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ImportedArticle } from "@/types/article";
import type { WordContext } from "@/types/reader";
import { documentUrl } from "@/lib/documentSource";
import { pdfLibrary, pdfOptions } from "@/lib/documentClient";
import styles from "./DocumentReader.module.css";

function selectedContext(event: MouseEvent, root: HTMLElement, article: ImportedArticle): WordContext | null {
  const doc = root.ownerDocument;
  const selection = doc.getSelection();
  let word = selection?.toString().trim() ?? "";
  if (word && (!selection?.anchorNode || !root.contains(selection.anchorNode))) return null;
  let node = selection?.anchorNode;
  if (!word) {
    const range = (doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(event.clientX, event.clientY);
    if (!range || range.startContainer.nodeType !== Node.TEXT_NODE || !root.contains(range.startContainer)) return null;
    node = range.startContainer;
    const text = node.textContent ?? "";
    const offset = range.startOffset;
    const match = Array.from(text.matchAll(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g)).find(m => m.index! <= offset && m.index! + m[0].length >= offset);
    if (!match) return null;
    word = match[0];
  }
  word = word.replace(/([a-z])-\s*\n\s*([a-z])/g, "$1$2").replace(/\s+/g, " ");
  if (!/[a-z]/i.test(word) || word.length > 500) return null;
  const page = (node?.parentElement?.closest("[data-document-page]") as HTMLElement | null)?.dataset.documentPage;
  const nearby = node?.parentElement?.closest("p,td,h1,h2,h3")?.textContent?.trim();
  const candidates = article.blocks.filter(b => !page || b.id.startsWith(`doc-p${page}-`));
  const block = candidates.find(b => b.text?.includes(nearby || node?.textContent || word)) ?? candidates.find(b => b.text?.includes(word));
  const index = block ? article.blocks.indexOf(block) : -1;
  return { word, sentence: (block?.text || nearby || word).slice(0, 6000), paragraphIndex: index, tokenIndex: 0,
    previousSentence: article.blocks[index - 1]?.text?.slice(-2000) || "", nextSentence: article.blocks[index + 1]?.text?.slice(0, 2000) || "" };
}

function PdfPage({ pdf, number, width }: { pdf: PDFDocumentProxy; number: number; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [height, setHeight] = useState(width * 1.414);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    void pdf.getPage(number).then(page => { const v = page.getViewport({ scale: 1 }); if (!disposed) setHeight(width * v.height / v.width); }).catch(() => undefined);
    return () => { disposed = true; };
  }, [pdf, number, width]);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setNear(entries.some(e => e.isIntersecting)), { rootMargin: "900px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const host = ref.current;
    if (!host || !near) return;
    let disposed = false;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    let layer: InstanceType<Awaited<ReturnType<typeof pdfLibrary>>["TextLayer"]> | undefined;
    void (async () => {
      const page = await pdf.getPage(number);
      if (disposed) return;
      const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      setHeight(viewport.height);
      const canvas = document.createElement("canvas");
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      canvas.setAttribute("aria-hidden", "true");
      const text = document.createElement("div"); text.className = "textLayer";
      text.style.setProperty("--total-scale-factor", String(viewport.scale));
      host.replaceChildren(canvas, text);
      render = page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      const library = await pdfLibrary();
      if (disposed) return;
      layer = new library.TextLayer({ textContentSource: await page.getTextContent(), container: text, viewport });
      await Promise.all([render.promise, layer.render()]);
    })().catch(() => { if (!disposed) setError("此页未能显示，请重新打开文档。"); });
    return () => { disposed = true; render?.cancel(); layer?.cancel(); host.replaceChildren(); };
  }, [pdf, number, width, near]);
  return <section className={styles.page} data-reader-block={`doc-p${number}-b0`} aria-label={`第 ${number} 页`} style={{ width, minHeight: height }}>
    <div ref={ref} data-document-page={number} style={{ minHeight: height }} />
    {error && <p role="alert">{error}</p>}
  </section>;
}

const WORD_SHELL = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; font-src data: blob:; style-src 'unsafe-inline';"><style>body{margin:0;background:#eee}*{box-sizing:border-box}::selection{background:#bddcff} .docx-wrapper{padding:0!important;background:#eee!important}section.docx{margin-bottom:16px!important;box-shadow:none!important}</style></head><body></body></html>`;

export function DocumentReader({ article, onLookup }: { article: ImportedArticle; onLookup: (context: WordContext) => void }) {
  const source = article.document!;
  const root = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const callback = useRef(onLookup); callback.current = onLookup;
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [wordBytes, setWordBytes] = useState<ArrayBuffer | null>(null);
  const [width, setWidth] = useState(700);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [frameReady, setFrameReady] = useState(false);
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(280, entries[0].contentRect.width)));
    observer.observe(host); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let task: ReturnType<Awaited<ReturnType<typeof pdfLibrary>>["getDocument"]> | undefined;
    setLoading(true); setError("");
    void (async () => {
      const response = await fetch(documentUrl(source), { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("文档暂时无法读取，请确认已联网并登录原账号。");
      const bytes = await response.arrayBuffer();
      if (controller.signal.aborted) return;
      if (source.format === "pdf") {
        const library = await pdfLibrary();
        task = library.getDocument({ data: bytes, ...pdfOptions });
        const loaded = await task.promise;
        if (!controller.signal.aborted) setPdf(loaded);
      } else setWordBytes(bytes);
      setLoading(false);
    })().catch(e => { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : "文档打开失败。"); setLoading(false); } });
    return () => { controller.abort(); void task?.destroy(); };
  }, [source.id, source.format]);
  useEffect(() => {
    if (!wordBytes || !frameReady || !iframe.current?.contentDocument) return;
    const frame = iframe.current, doc = frame.contentDocument!;
    let disposed = false;
    const click = (event: MouseEvent) => {
      event.preventDefault();
      const context = selectedContext(event, doc.body, article);
      if (context) callback.current(context);
    };
    void import("docx-preview").then(async ({ renderAsync }) => {
      await renderAsync(wordBytes, doc.body, undefined, { inWrapper: true, ignoreWidth: false, ignoreHeight: false,
        breakPages: true, renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
        renderAltChunks: false, useBase64URL: true });
      if (disposed) return;
      doc.querySelectorAll("a").forEach(a => a.removeAttribute("href"));
      const contentWidth = doc.body.scrollWidth;
      frame.style.width = `${contentWidth}px`;
      const scale = width * zoom / contentWidth;
      frame.style.transform = `scale(${scale})`;
      frame.style.height = `${doc.body.scrollHeight}px`;
      frame.parentElement!.style.height = `${doc.body.scrollHeight * scale}px`;
      doc.body.addEventListener("mouseup", click);
    }).catch(() => { if (!disposed) setError("Word 排版未能读取，请将文档另存为 PDF 后导入。"); });
    return () => { disposed = true; doc.body.removeEventListener("mouseup", click); };
  }, [wordBytes, frameReady, article, width, zoom]);
  return <div ref={root} className={styles.root} data-native-selection="blue" onPointerDown={e => e.stopPropagation()} onPointerMove={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
    <div className={styles.toolbar}>
      <span>{source.format.toUpperCase()} · {source.format === "pdf" ? `${source.pageCount} 页` : "原文排版"}</span>
      <div><button type="button" onClick={() => setZoom(v => Math.max(1, v - .25))} disabled={zoom === 1} aria-label="缩小文档">−</button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom(v => Math.min(2.5, v + .25))} disabled={zoom === 2.5} aria-label="放大文档">＋</button></div>
      <a href={documentUrl(source)} download={source.name}>下载原件</a>
    </div>
    {loading && <p role="status">正在打开文档…</p>}
    {error && <p role="alert">{error}</p>}
    <div className={styles.scroll} onMouseUp={event => {
      if ((event.target as HTMLElement).closest("button,a")) return;
      const context = selectedContext(event.nativeEvent, event.currentTarget, article);
      if (context) callback.current(context);
    }}>
      {error && <div className={styles.textFallback}><p>原件暂时不可用，以下为已保存的文字。</p>{article.blocks.map(block => <p key={block.id} data-reader-block={block.id}>{block.text}</p>)}</div>}
      {pdf && Array.from({ length: pdf.numPages }, (_, i) => <PdfPage key={i} pdf={pdf} number={i + 1} width={Math.round(width * zoom)} />)}
      {source.format === "docx" && <div style={{ position: "relative", width: width * zoom }}><iframe ref={iframe} title={source.name} sandbox="allow-same-origin" srcDoc={WORD_SHELL} onLoad={() => setFrameReady(true)} style={{ border: 0, transformOrigin: "top left", display: "block", width: 816, minHeight: 400 } as CSSProperties} /></div>}
    </div>
  </div>;
}
