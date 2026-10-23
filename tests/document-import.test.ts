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
  releaseVisible(); (await distant)(); second();
  assert.deepEqual(order, ["visible", "distant"]);
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
  assert.equal(documentTranslationContext(all.slice(0,20),[all[5]]).length,20);
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
