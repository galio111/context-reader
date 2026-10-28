"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { DocumentViewportControls } from "./DocumentViewportControls";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ImportedArticle } from "@/types/article";
import type { WordContext } from "@/types/reader";
import { cacheDocument, documentCacheOwner, readCachedDocument } from "@/lib/documentBinaryCache";
import { documentUrl } from "@/lib/documentSource";
import { pdfLibrary, pdfOptions } from "@/lib/documentClient";
import { readDocumentSelection, selectDocumentWord, documentCaretAtPoint, setDocumentDragRange, clearDocumentSelectionHighlight } from "@/lib/documentSelection";
import { observeSandboxedSelection } from "@/lib/documentSelectionObserver";
import { acquirePdfRender } from "@/lib/pdfRenderQueue";
import { createPageReader, type ReadingPdf } from "@/lib/documentPageReader";
import { DOCUMENT_RANGE_CHUNK, openDocumentRanges } from "@/lib/documentRangeReader";
import { cleanDocumentText } from "@/lib/documentUnicode";
import styles from "./DocumentReader.module.css";


function PdfPage({ pdf, number, width, zoom, preload, settled, enabled, detailReady, onPaint }: { pdf: ReadingPdf; enabled: boolean; detailReady: boolean; number: number; width: number; zoom: number; preload: boolean; settled: boolean; onPaint: (number: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const pageSection = useRef<HTMLElement>(null);
  const painted = useRef<{ width: number; key: string; full: boolean; ratio: number } | null>(null);
  const baseSize = useRef({ width: 612, height: 792 });
  const [near, setNear] = useState(number === 1);
  const [visible, setVisible] = useState(number === 1);
  const full = visible && settled;
  const [height, setHeight] = useState(width * 1.414);
  const [pageWidth, setPageWidth] = useState(width);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [detail, setDetail] = useState(false);
  const [originalReady, setOriginalReady] = useState(false);
  useEffect(() => {
    if (!ready || !full || !pdf.getFullPage || (!detailReady && zoom <= 1)) return;
    const timer = setTimeout(() => setDetail(true), 250);
    return () => clearTimeout(timer);
  }, [ready, full, pdf, detailReady, zoom]);
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    const scale = zoom ? zoom * 96 / 72 : width / baseSize.current.width;
    setHeight(baseSize.current.height * scale); setPageWidth(baseSize.current.width * scale);
  }, [width, zoom]);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setNear(entries.some(e => e.isIntersecting)), { rootMargin: "3000px" });
    // Observe the sized page, never the initially empty zero-height paint host.
    const visibleObserver = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)), { rootMargin: "150px" });
    if (pageSection.current) { observer.observe(pageSection.current); visibleObserver.observe(pageSection.current); }
    return () => { observer.disconnect(); visibleObserver.disconnect(); };
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
    if (!host || (!enabled && !visible) || (!near && !preload)) return;
    // After preparation, keep distant frames scaled instead of repainting the
    // entire paper for every zoom click. Sharpen when the page approaches view.
    if (!near && painted.current) return;
    const key = `${width}:${zoom}:${attempt}:${detail}`;
    if (!settled && painted.current) return;
    if (painted.current?.key === key && (!full || painted.current.full)) return;
    setError("");
    let disposed = false;
    let staging: HTMLDivElement | undefined;
    const controller = new AbortController();
    let release: (() => void) | undefined;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    let layer: InstanceType<Awaited<ReturnType<typeof pdfLibrary>>["TextLayer"]> | undefined;
    void (async () => {
      if (painted.current && painted.current.key !== key) {
        await new Promise(resolve => setTimeout(resolve, 120));
        if (disposed) return;
      }
      const bounds = host.getBoundingClientRect();
      release = await acquirePdfRender(controller.signal, Math.max(0, bounds.top - innerHeight, -bounds.bottom));
      if (disposed) return;
      const page = await (detail && pdf.getFullPage ? pdf.getFullPage(number) : pdf.getPage(number));
      if (disposed) return;
      const base = page.getViewport({ scale: 1 }); baseSize.current = { width: base.width, height: base.height };
      const viewport = page.getViewport({ scale: zoom ? zoom * 96 / 72 : width / page.getViewport({ scale: 1 }).width });
      setHeight(viewport.height); setPageWidth(viewport.width);
      const ratio = full
        ? Math.min(2, window.devicePixelRatio || 1, Math.sqrt(6_000_000 / (viewport.width * viewport.height)))
        : Math.min(window.devicePixelRatio || 1, Math.sqrt(1_500_000 / (viewport.width * viewport.height)));
      const library = await pdfLibrary();
      if (disposed) return;
      const retainedText = detail && painted.current?.full && painted.current.width === viewport.width
        ? host.querySelector<HTMLElement>(":scope > .textLayer") : null;
      if (full && painted.current?.key === key && painted.current.ratio >= ratio * .95) {
        // The prepared source canvas is already sharp enough. Add selection
        // without decoding and painting the same page a second time on scroll.
        const textContent = await page.getTextContent();
        if (disposed) return;
        const text = document.createElement("div"); text.className = "textLayer";
        text.style.setProperty("--total-scale-factor", String(viewport.scale)); text.style.visibility = "hidden";
        staging = text; host.append(text);
        const cleanContent = { ...textContent, items: textContent.items.map(item => "str" in item ? { ...item, str: cleanDocumentText(item.str) } : item) };
        layer = new library.TextLayer({ textContentSource: cleanContent, container: text, viewport });
        await layer.render();
        if (!disposed) {
          host.querySelectorAll(".textLayer").forEach(previous => { if (previous !== text) previous.remove(); });
          text.style.visibility = ""; staging = undefined;
          painted.current = { ...painted.current, full: true }; onPaint(number);
        }
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      canvas.setAttribute("aria-hidden", "true");
      const text = document.createElement("div"); text.className = "textLayer";
      text.style.setProperty("--total-scale-factor", String(viewport.scale));
      staging = document.createElement("div");
      staging.style.cssText = "position:absolute;left:0;top:0;visibility:hidden;pointer-events:none";
      staging.append(canvas, text);
      host.append(staging);
      // Paint source images, vectors and stored annotation appearances together;
      // the transparent text layer adds selection without replacing source text.
      if (full && !retainedText) {
        const textContent = await page.getTextContent();
        if (disposed) return;
        const cleanContent = { ...textContent, items: textContent.items.map(item => "str" in item ? { ...item, str: cleanDocumentText(item.str) } : item) };
        text.lang = textContent.lang || "en";
        layer = new library.TextLayer({ textContentSource: cleanContent, container: text, viewport });
        render = page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0], annotationMode: library.AnnotationMode.ENABLE_STORAGE });
        await Promise.all([render.promise, layer.render()]);
      } else {
        // Warm local originals without building thousands of offscreen glyph nodes.
        render = page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0], annotationMode: library.AnnotationMode.ENABLE_STORAGE });
        render.onContinue = (resume: () => void) => { requestAnimationFrame(resume); };
        await render.promise;
      }
      if (!disposed) {
        if (retainedText) {
          host.querySelector(":scope > canvas")?.replaceWith(canvas); staging?.remove();
        } else host.replaceChildren(canvas, text);
        host.style.width = `${viewport.width}px`;
        host.style.height = `${viewport.height}px`;
        host.style.transform = "none";
        painted.current = { width: viewport.width, key, full, ratio };
        setReady(true); setOriginalReady(detail || !pdf.getFullPage); onPaint(number);
      }
    })().catch(() => {
      staging?.remove();
      // A failed detail upgrade must not replace a usable page with an alert.
      if (!disposed && !painted.current) setError("此页未能完整显示。");
    }).finally(() => release?.());
    return () => { disposed = true; controller.abort(); render?.cancel(); layer?.cancel(); staging?.remove(); };
  }, [pdf, number, width, zoom, near, full, settled, preload, enabled, visible, detail, onPaint, attempt]);
  return <section ref={pageSection} className={styles.page} data-reader-block={`doc-p${number}-b0`} aria-label={`第 ${number} 页`} style={{ width: pageWidth, height }}>
    <div ref={ref} data-document-page={number} data-rendered={ready} data-original={originalReady} style={{ transformOrigin: "top left" }} />
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
  useEffect(() => {
    const releaseOutside = (event: MouseEvent) => {
      const container = scroller.current;
      if (!drag.current || !container || container.contains(event.target as Node)) return;
      const moved = drag.current.moved;
      drag.current = null;
      if (moved) {
        const context = readDocumentSelection(container, article);
        if (context) callback.current(context);
      }
    };
    const cancel = () => { drag.current = null; };
    window.addEventListener("mouseup", releaseOutside);
    window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("mouseup", releaseOutside); window.removeEventListener("blur", cancel); };
  }, [article]);
  const [scrollBusy, setScrollBusy] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => { setScrollBusy(true); clearTimeout(timer); timer = setTimeout(() => setScrollBusy(false), 180); };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => { clearTimeout(timer); window.removeEventListener("scroll", onScroll, true); };
  }, []);
  const warmOriginal = useRef<(() => Promise<void>) | null>(null);
  const [firstPaint, setFirstPaint] = useState(false);
  const [preparedPages, setPreparedPages] = useState<Set<number>>(() => new Set());
  const markPaint = useCallback((number: number) => {
    setFirstPaint(true);
    setPreparedPages(previous => previous.has(number) ? previous : new Set([...previous, number]));
  }, []);
  useEffect(() => {
    if (firstPaint) void warmOriginal.current?.().catch(() => undefined);
  }, [firstPaint]);
  const [pdf, setPdf] = useState<ReadingPdf | null>(null);
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
    let pages: ReturnType<typeof createPageReader> | undefined;
    let worker: InstanceType<Awaited<ReturnType<typeof pdfLibrary>>["PDFWorker"]> | undefined;
    setLoading(true); setError(""); setPdf(null); setWordBytes(null); setFirstPaint(false); setPreparedPages(new Set()); warmOriginal.current = null;
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
        // Fetch only the first source page before displaying the reader. Other
        // pages enter the existing visible-first render queue after first paint.
        pages = createPageReader(library, worker!, owner, source.id, documentUrl(source), source.pageCount, controller.signal);
        try {
          await pages.reader.getPage(1);
          if (controller.signal.aborted) return;
          setPdf(pages.reader); setLoading(false); return;
        } catch {
          await pages.destroy(); pages = undefined;
          if (controller.signal.aborted) return;
        }
        const ranges = await openDocumentRanges(owner, source.id, documentUrl(source), controller.signal);
        if (controller.signal.aborted) return;
        warmOriginal.current = () => ranges.warm();
        const transport = new class extends library.PDFDataRangeTransport {
          requestDataRange(begin: number, end: number) {
            void ranges.read(begin, end).then(chunk => {
              if (!controller.signal.aborted) this.onDataRange(begin, chunk);
            }).catch(error => {
              if (!controller.signal.aborted) {
                setError(error instanceof Error ? error.message : "文档暂时无法读取。");
                setLoading(false); void task?.destroy();
              }
            });
          }
          abort() { controller.abort(); }
        }(ranges.length, ranges.initialData, true);
        task = library.getDocument({ range: transport, worker, ...pdfOptions,
          rangeChunkSize: DOCUMENT_RANGE_CHUNK, disableAutoFetch: true, disableStream: true });
        const loaded = await task.promise;
        if (controller.signal.aborted) return;
        setPdf(loaded); setLoading(false);
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
    return () => { controller.abort(); if (pages) { void pages.destroy().finally(() => worker?.destroy()); return; } if (task) void task.destroy().finally(() => worker?.destroy()); else worker?.destroy(); };
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
      // Keep drag ranges consistent across the PDF text layer's positioned runs.
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
      {pdf && Array.from({ length: pdf.numPages }, (_, i) => <PdfPage key={i} pdf={pdf} number={i + 1} width={width} zoom={zoom} enabled={i === 0 || firstPaint} detailReady={preparedPages.size === pdf.numPages} preload={firstPaint && pdf.numPages <= 24} settled={!scrollBusy} onPaint={markPaint} />)}
      {source.format === "docx" && <div style={{ position: "relative", width: zoom ? 816 * zoom : width }}><iframe ref={iframe} title={source.name} sandbox="allow-same-origin" srcDoc={WORD_SHELL} onLoad={() => setFrameReady(true)} style={{ border: 0, transformOrigin: "top left", display: "block", width: 816, minHeight: 400 } as CSSProperties} /><div ref={wordMouseSurface} className={styles.wordMouseSurface} aria-hidden="true" /></div>}
    </div>
  </div>;
}
