"use client";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { DocumentViewportControls } from "./DocumentViewportControls";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ImportedArticle } from "@/types/article";
import type { WordContext } from "@/types/reader";
import { cacheDocument, documentCacheOwner, readCachedDocument } from "@/lib/documentBinaryCache";
import { documentUrl } from "@/lib/documentSource";
import { pdfLibrary, pdfOptions } from "@/lib/documentClient";
import { readDocumentSelection, selectDocumentWord, documentCaretAtPoint, setDocumentDragRange, clearDocumentSelectionHighlight } from "@/lib/documentSelection";
import { recordPdfGlyphs, alignPdfTextLayer } from "@/lib/pdfSelectionGeometry";
import { observeSandboxedSelection } from "@/lib/documentSelectionObserver";
import { acquirePdfRender } from "@/lib/pdfRenderQueue";
import styles from "./DocumentReader.module.css";


function PdfPage({ pdf, number, width, zoom }: { pdf: PDFDocumentProxy; number: number; width: number; zoom: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const painted = useRef<{ width: number; key: string } | null>(null);
  const [near, setNear] = useState(false);
  const [height, setHeight] = useState(width * 1.414);
  const [pageWidth, setPageWidth] = useState(width);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    void pdf.getPage(number).then(page => { const base = page.getViewport({ scale: 1 }); const v = page.getViewport({ scale: zoom ? zoom * 96 / 72 : width / base.width }); if (!disposed) { setHeight(v.height); setPageWidth(v.width); } }).catch(() => undefined);
    return () => { disposed = true; };
  }, [pdf, number, width, zoom]);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setNear(entries.some(e => e.isIntersecting)), { rootMargin: "3000px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const host = ref.current;
    if (host && painted.current) {
      // Keep the complete previous frame and its selection geometry visible
      // immediately while a sharper frame is rendered offscreen.
      host.style.width = `${painted.current.width}px`;
      host.style.transform = `scale(${pageWidth / painted.current.width})`;
    }
  }, [pageWidth]);
  useEffect(() => {
    const host = ref.current;
    if (!host || !near) return;
    const key = `${width}:${zoom}:${attempt}`;
    if (painted.current?.key === key) return;
    setError("");
    let disposed = false;
    let staging: HTMLDivElement | undefined;
    const controller = new AbortController();
    let release: (() => void) | undefined;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    let layer: InstanceType<Awaited<ReturnType<typeof pdfLibrary>>["TextLayer"]> | undefined;
    void (async () => {
      const bounds = host.getBoundingClientRect();
      release = await acquirePdfRender(controller.signal, Math.max(0, bounds.top - innerHeight, -bounds.bottom));
      if (disposed) return;
      const page = await pdf.getPage(number);
      if (disposed) return;
      const viewport = page.getViewport({ scale: zoom ? zoom * 96 / 72 : width / page.getViewport({ scale: 1 }).width });
      setHeight(viewport.height); setPageWidth(viewport.width);
      const canvas = document.createElement("canvas");
      const ratio = Math.min(2, window.devicePixelRatio || 1, Math.sqrt(6_000_000 / (viewport.width * viewport.height)));
      canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      canvas.setAttribute("aria-hidden", "true");
      const text = document.createElement("div"); text.className = "textLayer";
      text.style.setProperty("--total-scale-factor", String(viewport.scale));
      staging = document.createElement("div");
      staging.style.cssText = "position:absolute;left:0;top:0;visibility:hidden;pointer-events:none";
      staging.append(canvas, text);
      host.append(staging);
      const library = await pdfLibrary();
      if (disposed) return;
      // Paint source images, vectors and stored annotation appearances together;
      // the transparent text layer adds selection without replacing source text.
      const [textContent, recording] = await Promise.all([page.getTextContent(), recordPdfGlyphs(page, canvas.getContext("2d")!, ratio, library.OPS)]);
      if (disposed) { recording.restore(); return; }
      text.lang = textContent.lang || "en";
      layer = new library.TextLayer({ textContentSource: textContent, container: text, viewport });
      render = page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0], annotationMode: library.AnnotationMode.ENABLE_STORAGE });
      try {
        await Promise.all([render.promise, layer.render()]);
        if (!disposed && viewport.rotation === 0) alignPdfTextLayer(text, recording.glyphs, viewport.scale,
          textContent.items.filter((item): item is import("pdfjs-dist/types/src/display/api").TextItem => "str" in item), viewport.height);
      } finally { recording.restore(); }
      if (!disposed) {
        host.replaceChildren(canvas, text);
        host.style.width = `${viewport.width}px`;
        host.style.height = `${viewport.height}px`;
        host.style.transform = "none";
        painted.current = { width: viewport.width, key };
        setReady(true);
      }
    })().catch(() => { staging?.remove(); if (!disposed) setError("此页未能完整显示。"); }).finally(() => release?.());
    return () => { disposed = true; controller.abort(); render?.cancel(); layer?.cancel(); staging?.remove(); };
  }, [pdf, number, width, zoom, near, attempt]);
  return <section className={styles.page} data-reader-block={`doc-p${number}-b0`} aria-label={`第 ${number} 页`} style={{ width: pageWidth, height }}>
    <div ref={ref} data-document-page={number} data-rendered={ready} style={{ transformOrigin: "top left" }} />
    {!ready && !error && <span className={styles.pageStatus}>第 {number} 页</span>}
    {error && <p className={styles.pageStatus} role="alert">{error} <button type="button" onClick={() => setAttempt(v => v + 1)}>重新显示</button></p>}
  </section>;
}

const WORD_SHELL = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; font-src data: blob:; style-src 'unsafe-inline';"><style>body{margin:0;background:#eee}*{box-sizing:border-box}::selection{background:#bddcff} .docx-wrapper{padding:0!important;background:#eee!important}section.docx{margin-bottom:16px!important;box-shadow:none!important}</style></head><body></body></html>`;

export function DocumentReader({ article, onLookup }: { article: ImportedArticle; onLookup: (context: WordContext) => void }) {
  const source = article.document!;
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const wordMouseSurface = useRef<HTMLDivElement>(null);
  const callback = useRef(onLookup); callback.current = onLookup;
  const drag = useRef<{ anchor: Range; x: number; y: number; moved: boolean } | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [wordBytes, setWordBytes] = useState<ArrayBuffer | null>(null);
  const [width, setWidth] = useState(700);
  const [zoom, setZoom] = useState(0);
  const [attempt, setAttempt] = useState(0);
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
    let worker: InstanceType<Awaited<ReturnType<typeof pdfLibrary>>["PDFWorker"]> | undefined;
    setLoading(true); setError(""); setPdf(null); setWordBytes(null);
    void (async () => {
      const owner = documentCacheOwner();
      const libraryPromise = source.format === "pdf" ? pdfLibrary().then(async library => {
        if (!controller.signal.aborted) { worker = new library.PDFWorker(); await worker.promise; }
        return library;
      }) : null;
      void libraryPromise?.catch(() => undefined);
      let bytes = await readCachedDocument(owner, source.id);
      if (controller.signal.aborted) return;
      if (!bytes && source.format === "pdf") {
        const library = await libraryPromise!;
        if (controller.signal.aborted) return;
        // Render from streaming/range reads instead of waiting for the entire
        // large original to download. Keep the full original cache asynchronous.
        task = library.getDocument({ url: documentUrl(source), worker, ...pdfOptions,
          withCredentials: true, rangeChunkSize: 256 * 1024 });
        const loaded = await task.promise;
        if (controller.signal.aborted) return;
        setPdf(loaded); setLoading(false);
        void loaded.getData().then(data => {
          if (!controller.signal.aborted) return cacheDocument(owner, source.id, data.slice().buffer as ArrayBuffer);
        }).catch(() => undefined);
        return;
      }
      if (!bytes) {
      let response: Response | undefined;
      for (let retry = 0; retry < 3; retry++) {
        try {
          response = await fetch(documentUrl(source), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]), cache: "no-store" });
          if (response.ok || response.status < 500) break;
        } catch (failure) { if (controller.signal.aborted || retry === 2) throw failure; }
        await new Promise(resolve => setTimeout(resolve, 500 * (retry + 1)));
      }
      if (!response) throw new Error("原 PDF 暂时无法读取，请联网后重试。");
      if (!response.ok) throw new Error("文档暂时无法读取，请确认已联网并登录原账号。");
      bytes = await response.arrayBuffer();
      if (controller.signal.aborted) return;
      void cacheDocument(owner, source.id, bytes);
      }
      if (source.format === "pdf") {
        const library = await libraryPromise!;
        if (controller.signal.aborted) return;
        task = library.getDocument({ data: bytes, worker, ...pdfOptions });
        const loaded = await task.promise;
        if (!controller.signal.aborted) setPdf(loaded);
      } else setWordBytes(bytes);
      setLoading(false);
    })().catch(e => { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : "文档打开失败。"); setLoading(false); } });
    return () => { controller.abort(); if (task) void task.destroy().finally(() => worker?.destroy()); else worker?.destroy(); };
  }, [source.id, source.format, attempt]);
  useEffect(() => {
    if (!wordBytes || !frameReady || !iframe.current?.contentDocument) return;
    const frame = iframe.current, doc = frame.contentDocument!;
    let disposed = false;
    let anchor: Range | null = null;
    let eventsUntil = 0;
    let stopObserving: (() => void) | undefined;
    let moved = false;
    let startX = 0, startY = 0;
    const down = (event: MouseEvent) => {
      eventsUntil = Date.now() + 500;
      if (event.button !== 0) return;
      anchor = documentCaretAtPoint(doc.body, event.clientX, event.clientY);
      moved = false; startX = event.clientX; startY = event.clientY;
      if (!anchor) return;
      // Starting inside an existing selection must select again, not start the
      // browser's native text drag-and-drop operation inside the iframe.
      event.preventDefault();
      doc.getSelection()?.removeAllRanges();
    };
    const move = (event: MouseEvent) => {
      if (!anchor || event.buttons !== 1) return;
      if (!moved && Math.hypot(event.clientX - startX, event.clientY - startY) < 3) return;
      const focus = documentCaretAtPoint(doc.body, event.clientX, event.clientY);
      if (focus) { moved = true; setDocumentDragRange(anchor, focus); }
    };
    const submit = () => {
      const context = readDocumentSelection(doc.body, article);
      if (context) callback.current(context);
    };
    const up = () => {
      const selected = moved;
      if (anchor) eventsUntil = Date.now() + 500;
      anchor = null; moved = false;
      if (selected) submit();
    };
    const keyup = (event: KeyboardEvent) => {
      eventsUntil = Date.now() + 500;
      if (event.shiftKey && event.key.startsWith("Arrow")) submit();
    };
    const touchend = () => requestAnimationFrame(() => { if (!disposed) { eventsUntil = Date.now() + 500; submit(); } });
    const doubleClick = (event: MouseEvent) => {
      eventsUntil = Date.now() + 500;
      const context = selectDocumentWord(event, doc.body, article);
      if (context) callback.current(context);
    };
    // Mouse events in a script-disabled iframe are suppressed by WebKit. The
    // transparent parent surface owns mouse selection; source pixels stay in
    // the sandbox and native touch/keyboard ranges use the observer below.
    const surface = wordMouseSurface.current;
    const frameEvent = (event: MouseEvent) => {
      const bounds = frame.getBoundingClientRect();
      return new MouseEvent(event.type, { button: event.button, buttons: event.buttons,
        clientX: (event.clientX - bounds.left) * frame.clientWidth / bounds.width,
        clientY: (event.clientY - bounds.top) * frame.clientHeight / bounds.height });
    };
    const surfaceDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault(); frame.contentWindow?.focus(); down(frameEvent(event));
    };
    const surfaceMove = (event: MouseEvent) => { if (anchor) move(frameEvent(event)); };
    const surfaceDoubleClick = (event: MouseEvent) => { event.preventDefault(); doubleClick(frameEvent(event)); };
    void import("docx-preview").then(async ({ renderAsync }) => {
      await renderAsync(wordBytes, doc.body, undefined, { inWrapper: true, ignoreWidth: false, ignoreHeight: false,
        breakPages: true, renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
        renderAltChunks: false, useBase64URL: true });
      if (disposed) return;
      doc.querySelectorAll("a").forEach(a => a.removeAttribute("href"));
      const contentWidth = doc.body.scrollWidth;
      frame.style.width = `${contentWidth}px`;
      const scale = zoom || width / contentWidth;
      frame.style.transform = `scale(${scale})`;
      frame.style.height = `${doc.body.scrollHeight}px`;
      frame.parentElement!.style.width = `${contentWidth * scale}px`;
      frame.parentElement!.style.height = `${doc.body.scrollHeight * scale}px`;
      doc.addEventListener("mousedown", down);
      doc.addEventListener("mousemove", move);
      doc.addEventListener("mouseup", up);
      doc.addEventListener("dblclick", doubleClick);
      doc.addEventListener("keyup", keyup);
      doc.addEventListener("touchend", touchend);
      frame.ownerDocument.addEventListener("mouseup", up);
      surface?.addEventListener("mousedown", surfaceDown);
      surface?.addEventListener("dblclick", surfaceDoubleClick);
      frame.ownerDocument.addEventListener("mousemove", surfaceMove);
      stopObserving = observeSandboxedSelection(frame, () => Boolean(anchor) || Date.now() < eventsUntil, submit);
    }).catch(() => { if (!disposed) setError("Word 排版未能读取，请将文档另存为 PDF 后导入。"); });
    return () => {
      disposed = true;
      stopObserving?.();
      doc.removeEventListener("mousedown", down); doc.removeEventListener("mousemove", move);
      doc.removeEventListener("mouseup", up); doc.removeEventListener("dblclick", doubleClick);
      doc.removeEventListener("keyup", keyup); doc.removeEventListener("touchend", touchend);
      frame.ownerDocument.removeEventListener("mouseup", up);
      surface?.removeEventListener("mousedown", surfaceDown);
      surface?.removeEventListener("dblclick", surfaceDoubleClick);
      frame.ownerDocument.removeEventListener("mousemove", surfaceMove);
    };
  }, [wordBytes, frameReady, article, width, zoom]);
  return <div ref={root} className={styles.root} data-native-selection="blue" onPointerDown={e => e.stopPropagation()} onPointerMove={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
    <DocumentViewportControls root={root} scroller={scroller}>
      <span>{source.format.toUpperCase()} · {source.format === "pdf" ? `${source.pageCount} 页` : "原文排版"}</span>
      <div><button type="button" onClick={() => setZoom(v => Math.max(.25, (v || 1) - .25))} disabled={zoom === .25} aria-label="缩小文档">−</button><span>{zoom ? `${Math.round(zoom * 100)}%` : "适合宽度"}</span><button type="button" onClick={() => setZoom(v => Math.min(4, (v || 1) + .25))} disabled={zoom === 4} aria-label="放大文档">＋</button><button className={styles.scaleChoice} type="button" aria-label="原始比例 100%" onClick={() => setZoom(1)}>100%</button><button className={styles.scaleChoice} type="button" onClick={() => setZoom(0)}>适宽</button></div>
      <a href={documentUrl(source)} download={source.name}>下载原件</a>
    </DocumentViewportControls>
    {loading && <p role="status">正在打开文档…</p>}
    {error && <p role="alert">原件暂时未能打开，页面、图片和标注仍保存在原文件中。<button className={styles.retry} type="button" onClick={() => setAttempt(v => v + 1)}>重新打开原件</button></p>}
    <div ref={scroller} className={styles.scroll} data-document-selection-root onMouseDown={event => {
      if (event.button !== 0 || !(event.target as Element).closest(".textLayer")) return;
      const anchor = documentCaretAtPoint(event.currentTarget, event.clientX, event.clientY);
      drag.current = anchor ? { anchor, x: event.clientX, y: event.clientY, moved: false } : null;
      // Per-glyph positioned nodes need an explicit range across glyph boundaries.
      event.preventDefault();
      event.currentTarget.ownerDocument.getSelection()?.removeAllRanges();
      clearDocumentSelectionHighlight(event.currentTarget);
    }} onMouseMove={event => {
      const current = drag.current;
      if (!current || event.buttons !== 1) return;
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 3 && !current.moved) return;
      const focus = documentCaretAtPoint(event.currentTarget, event.clientX, event.clientY);
      if (focus) { current.moved = true; setDocumentDragRange(current.anchor, focus); }
    }} onMouseUp={event => {
      const current = drag.current; drag.current = null;
      if (current && !current.moved) return;
      if (event.detail > 1) return;
      if ((event.target as HTMLElement).closest("button,a")) return;
      const context = readDocumentSelection(event.currentTarget, article);
      if (context) callback.current(context);
    }} onDoubleClick={event => {
      event.stopPropagation();
      const context = selectDocumentWord(event.nativeEvent, event.currentTarget, article);
      if (context) callback.current(context);
    }} onKeyUp={event => {
      if (event.shiftKey && event.key.startsWith("Arrow")) {
        const context = readDocumentSelection(event.currentTarget, article);
        if (context) callback.current(context);
      }
    }}>
      {pdf && Array.from({ length: pdf.numPages }, (_, i) => <PdfPage key={i} pdf={pdf} number={i + 1} width={width} zoom={zoom} />)}
      {source.format === "docx" && <div style={{ position: "relative", width: zoom ? 816 * zoom : width }}><iframe ref={iframe} title={source.name} sandbox="allow-same-origin" srcDoc={WORD_SHELL} onLoad={() => setFrameReady(true)} style={{ border: 0, transformOrigin: "top left", display: "block", width: 816, minHeight: 400 } as CSSProperties} /><div ref={wordMouseSurface} className={styles.wordMouseSurface} aria-hidden="true" /></div>}
    </div>
  </div>;
}
