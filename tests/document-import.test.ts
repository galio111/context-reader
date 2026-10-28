import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { validateDocumentBytes } from "../lib/documentValidation";
import { normalizeDocumentSource, documentUrl } from "../lib/documentSource";
import { pdfPageBlocks, type PdfTextItem } from "../lib/documentText";
import { documentTranslationContext } from "../lib/documentTranslationContext";
import { normalizeImportedArticleStructure } from "../lib/importedArticleNormalization";
import { protectApiRequest } from "../lib/requestSecurity";
import nextConfig from "../next.config";
import { MAX_DOCUMENT_BYTES } from "../lib/documentSource";
import { readFormDataBody } from "../lib/limitedBody";
import { acquirePdfRender } from "../lib/pdfRenderQueue";
test("PDF worker permits bundled WASM decoding without permitting JavaScript eval", async () => {
  const rules = await nextConfig.headers!();
  const workerPolicy = rules.filter(rule => rule.source === "/document-runtime/:version/:path*")
    .flatMap(rule => rule.headers).find(header => header.key === "Content-Security-Policy")?.value;
  assert.ok(workerPolicy?.includes("'wasm-unsafe-eval'"));
  if (process.env.NODE_ENV !== "development") assert.ok(!workerPolicy?.includes("'unsafe-eval'"));
});
test("visible page rendering overtakes queued preloads and cancelled work leaves the queue", async () => {
  const first = await acquirePdfRender(new AbortController().signal, 0);
  const second = await acquirePdfRender(new AbortController().signal, 0);
  const order: string[] = [];
  const distant = acquirePdfRender(new AbortController().signal, 3000).then(release => { order.push("distant"); return release; });
  const cancelled = new AbortController();
  const cancelledJob = acquirePdfRender(cancelled.signal, 1000);
  const cancelledAssertion = assert.rejects(cancelledJob, /superseded/);
  const visible = acquirePdfRender(new AbortController().signal, 0).then(release => { order.push("visible"); return release; });
  cancelled.abort(); await cancelledAssertion;
  first(); const releaseVisible = await visible;
  assert.deepEqual(order, ["visible"]);
  releaseVisible();
  await Promise.resolve(); assert.deepEqual(order, ["visible"], "background waits while a visible page still owns a slot");
  second(); (await distant)();
  assert.deepEqual(order, ["visible", "distant"]);
});
test("one background page is prepared at a time while a newly visible page can start immediately", async () => {
  const first = await acquirePdfRender(new AbortController().signal, 1000);
  let backgroundStarted = false;
  const next = acquirePdfRender(new AbortController().signal, 2000).then(release => { backgroundStarted = true; return release; });
  const visible = await acquirePdfRender(new AbortController().signal, 0);
  assert.equal(backgroundStarted, false);
  visible(); first(); (await next)();
});
test("middleware preserves the entire advertised 50 MiB multipart document", async () => {
  const form = new FormData();
  const bytes = new Uint8Array(MAX_DOCUMENT_BYTES);
  bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
  bytes.set(new TextEncoder().encode("\n%%EOF"), bytes.length - 6);
  form.set("file", new File([bytes], "large-paper.pdf", { type: "application/pdf" }));
  const request = new Request("https://context-reader.com/api/documents", { method: "POST", body: form });
  const serialized = await request.clone().arrayBuffer();
  assert.ok(Number(nextConfig.experimental?.middlewareClientMaxBodySize) >= serialized.byteLength);
  const parsed = await readFormDataBody(request, MAX_DOCUMENT_BYTES + 16384);
  const file = parsed.get("file") as File;
  assert.equal(file.size, bytes.length);
  const restored = new Uint8Array(await file.arrayBuffer());
  validateDocumentBytes(restored, "pdf");
  assert.deepEqual(restored.slice(-6), bytes.slice(-6));
});
const item = (str: string, x: number, y: number): PdfTextItem => ({ str, transform: [10,0,0,10,x,y], width: 100, height: 10, hasEOL: true });
test("API middleware accepts the advertised document limit and still rejects oversized bodies", () => {
  const request = (bytes: number, path = "/api/documents") => new Request(`https://context-reader.com${path}`, {method:"POST",headers:{"content-length":String(bytes),origin:"https://context-reader.com"}});
  assert.equal(protectApiRequest(request(1_788_008)),null);
  assert.equal(protectApiRequest(request(MAX_DOCUMENT_BYTES+1000)),null);
  assert.equal(protectApiRequest(request(MAX_DOCUMENT_BYTES+20000))?.status,413);
  assert.equal(protectApiRequest(request(100_000,"/api/auth/phone-login"))?.status,413);
});
test("PDF reading order retains columns and joins line-wrap hyphens", () => {
  const blocks = pdfPageBlocks([item("The antibac-",40,700), item("terial treatment is effective.",40,688), item("Right column begins.",310,700)],1);
  assert.equal(blocks[0].text,"The antibacterial treatment is effective.");
  assert.equal(blocks[1].text,"Right column begins.");
  assert.equal(blocks[1].id,"doc-p1-b1");
});
test("document references accept only private opaque IDs", () => {
  assert.equal(normalizeDocumentSource({id:"https://evil.test/file",format:"pdf"}),undefined);
  const source=normalizeDocumentSource({id:"a".repeat(64),format:"pdf",name:"Paper",pageCount:11})!;
  assert.equal(documentUrl(source),`/api/documents/${"a".repeat(64)}?format=pdf`);
});
test("document save normalization preserves page IDs and repeated source content", () => {
  const blocks = [{id:"doc-p1-b0",type:"paragraph" as const,text:"Repeated label"},{id:"doc-p2-b0",type:"paragraph" as const,text:"Repeated label"}];
  const article = {title:"Paper",url:"",siteName:"PDF",text:"Repeated label\n\nRepeated label",blocks,document:{id:"a".repeat(64),format:"pdf" as const,name:"Paper.pdf",pageCount:2}};
  assert.deepEqual(normalizeImportedArticleStructure(article),article);
});
test("long document translation includes the final target and its neighbours", () => {
  const all=Array.from({length:400},(_,i)=>({id:`doc-p${i+1}-b0`,type:"paragraph" as const,text:`Section ${i} `+"x".repeat(500)}));
  const selected=documentTranslationContext(all,[all[398]]);
  assert.ok(selected.some(b=>b.id===all[398].id));
  assert.ok(selected.some(b=>b.id===all[397].id));
  assert.ok(selected.some(b=>b.id===all[0].id));
  assert.ok(selected.reduce((n,b)=>n+b.text.length,0)<=60000);
  assert.ok(selected.reduce((n,b)=>n+b.text.length,0)<=4000);
  assert.equal(documentTranslationContext(all.slice(0,3),[all[1]]).length,3);
});
test("file validation rejects disguised files, encryption and expanded ZIP bombs", async () => {
  assert.throws(()=>validateDocumentBytes(new TextEncoder().encode("<script>"),"pdf"));
  const zip=new JSZip();zip.file("word/document.xml","<doc/> ");
  const bytes=await zip.generateAsync({type:"uint8array"});
  validateDocumentBytes(bytes,"docx");
  const malformed=bytes.slice();const view=new DataView(malformed.buffer);
  for(let i=0;i<malformed.length-46;i++)if(view.getUint32(i,true)===0x02014b50){view.setUint32(i+24,100*1024*1024,true);break;}
  assert.throws(()=>validateDocumentBytes(malformed,"docx"),/过大/);
  zip.file("word/vbaProject.bin","macro");
  assert.throws(()=>validateDocumentBytes(bytes.slice(0,30),"docx"));
  assert.throws(()=>validateDocumentBytes(new Uint8Array(2),"docx"));
  assert.throws(()=>validateDocumentBytes(new TextEncoder().encode("not a zip"),"docx"));
  const macro=await zip.generateAsync({type:"uint8array"});
  assert.throws(()=>validateDocumentBytes(macro,"docx"),/宏/);
});


test("document range cache reopens without downloading an original and deduplicates overlapping reads", async () => {
  const { openDocumentRanges, DOCUMENT_RANGE_CHUNK: size } = await import("../lib/documentRangeReader");
  const source = Uint8Array.from({ length: size * 3 + 17 }, (_, i) => i % 251);
  const cache = new Map<string, ArrayBuffer>();
  const requests: string[] = [];
  const io = {
    read: async (key: string) => cache.get(key)?.slice(0) ?? null,
    write: async (key: string, bytes: ArrayBuffer) => { cache.set(key, bytes.slice(0)); },
    fetch: (async (_: unknown, options: RequestInit) => {
      const range = (options.headers as Record<string,string>).Range;
      requests.push(range);
      const [begin, inclusive] = range.slice(6).split("-").map(Number);
      const end = Math.min(inclusive + 1, source.length);
      return new Response(source.slice(begin, end), { status: 206, headers: { "content-range": `bytes ${begin}-${end-1}/${source.length}` } });
    }) as typeof fetch,
  };
  const signal = new AbortController().signal;
  const first = await openDocumentRanges("owner", "paper", "/source", signal, io);
  structuredClone(first.initialData, { transfer: [first.initialData.buffer] });
  assert.deepEqual(await first.read(0, 100), source.slice(0, 100), "PDF worker transfer cannot detach the reader cache");
  const [a, b] = await Promise.all([first.read(size, size * 2 + 10), first.read(size + 7, size * 2 + 5)]);
  assert.deepEqual(a, source.slice(size, size * 2 + 10));
  assert.deepEqual(b, source.slice(size + 7, size * 2 + 5));
  assert.equal(requests.length, 4, "header, adjacent resources and tail share bounded requests");
  await first.warm();
  assert.deepEqual(new Uint8Array(cache.get("paper")!), source, "background ranges reconstruct an intact cached original");
  assert.equal(requests.length, 4, "warming shares every existing request");
  const reopened = await openDocumentRanges("owner", "paper", "/source", signal, io);
  assert.deepEqual(await reopened.read(0, size * 2 + 10), source.slice(0, size * 2 + 10));
  assert.equal(requests.length, 4, "reopening uses the persisted chunks");
});

test("invalid range responses fail instead of leaving a blank page waiting forever", async () => {
  const { openDocumentRanges } = await import("../lib/documentRangeReader");
  let requests = 0;
  await assert.rejects(openDocumentRanges(null, "paper", "/source", new AbortController().signal, {
    read: async () => null, write: async () => undefined,
    fetch: (async () => { requests++; return new Response(new Uint8Array(3), { status: 206, headers: { "content-range": "bytes 0-4/1000" } }); }) as typeof fetch,
  }), /读取不完整/);
  assert.equal(requests, 2);
});

test("reading pages preserve text resources and geometry without changing the original", async () => {
  const { PDFDocument, PDFName } = await import("pdf-lib");
  const { copyReadingPage } = await import("../lib/documentPageStore");
  const source = await PDFDocument.create();
  source.addPage([300, 500]).drawText("First page");
  source.addPage([500, 300]).drawText("Second page");
  const original = await source.save();
  const page = await PDFDocument.load(await copyReadingPage(source, 2));
  assert.equal(page.getPageCount(), 1);
  assert.deepEqual(page.getPage(0).getSize(), { width: 500, height: 300 });
  assert.ok(page.getPage(0).node.Resources());
  assert.deepEqual(await source.save(), original);
  await assert.rejects(copyReadingPage(source, 3));
  for (const feature of ["AcroForm", "OCProperties", "OutputIntents"]) {
    source.catalog.set(PDFName.of(feature), source.context.obj({}));
    await assert.rejects(copyReadingPage(source, 1), /Original document required/);
    source.catalog.delete(PDFName.of(feature));
  }
});

test("page delivery recovers once from interrupted transfer and stops on reader cancellation", async () => {
  const { createPageReader } = await import("../lib/documentPageReader");
  const originalFetch = globalThis.fetch;
  let reads = 0, destroyed = 0;
  const page = { pageNumber: 1 };
  const library = { getDocument: ({ data }: { data: ArrayBuffer }) => {
    assert.deepEqual([...new Uint8Array(data)], [1, 2, 3]);
    return { promise: Promise.resolve({ getPage: async () => page }), destroy: async () => { destroyed++; } };
  } } as unknown as typeof import("pdfjs-dist");
  const controller = new AbortController();
  try {
    globalThis.fetch = (async () => {
      reads++;
      if (reads === 1) throw new TypeError("Interrupted transfer");
      return new Response(new Uint8Array([1, 2, 3]));
    }) as typeof fetch;
    const source = createPageReader(library, {} as InstanceType<typeof library.PDFWorker>, null, "test-page", "/source?format=pdf", 2, controller.signal);
    const [a, b] = await Promise.all([source.reader.getPage(1), source.reader.getPage(1)]);
    assert.equal(a, page); assert.equal(b, page); assert.equal(reads, 2);
    controller.abort();
    await assert.rejects(source.reader.getPage(2), { name: "AbortError" });
    assert.equal(reads, 2);
    await source.destroy(); assert.equal(destroyed, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("disposable reading previews reduce heavy images without mutating the original page", async () => {
  const { PDFDocument, PDFName, PDFRawStream } = await import("pdf-lib");
  const sharp = (await import("sharp")).default;
  const { copyReadingPage } = await import("../lib/documentPageStore");
  let random = 12345;
  const pixels = Buffer.alloc(900 * 900 * 3);
  for (let i = 0; i < pixels.length; i++) { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; pixels[i] = random & 255; }
  const jpeg = await sharp(pixels, { raw: { width: 900, height: 900, channels: 3 } }).jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer();
  const source = await PDFDocument.create();
  const image = await source.embedJpg(jpeg);
  source.addPage([600, 800]).drawImage(image, { x: 30, y: 100, width: 540, height: 540 });
  source.getPage(0).drawText("Native selectable caption", { x: 30, y: 60 });
  const original = await source.save();
  const preview = await copyReadingPage(source, 1, true);
  assert.ok(preview.length < original.length * .75);
  assert.deepEqual(await source.save(), original);
  const parsed = await PDFDocument.load(preview);
  assert.deepEqual(parsed.getPage(0).getSize(), { width: 600, height: 800 });
  const images = parsed.context.enumerateIndirectObjects().filter(([, value]) => value instanceof PDFRawStream && value.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"));
  assert.equal(images.length, 1, "the image is reduced, never removed");
  assert.ok(parsed.getPage(0).node.Resources());
});
