import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { validateDocumentBytes } from "../lib/documentValidation";
import { normalizeDocumentSource, documentUrl } from "../lib/documentSource";
import { pdfPageBlocks, type PdfTextItem } from "../lib/documentText";
import { documentTranslationContext } from "../lib/documentTranslationContext";
import { normalizeImportedArticleStructure } from "../lib/importedArticleNormalization";
import { protectApiRequest } from "../lib/requestSecurity";
const item = (str: string, x: number, y: number): PdfTextItem => ({ str, transform: [10,0,0,10,x,y], width: 100, height: 10, hasEOL: true });
test("API middleware accepts the advertised document limit and still rejects oversized bodies", () => {
  const request = (bytes: number, path = "/api/documents") => new Request(`https://context-reader.com${path}`, {method:"POST",headers:{"content-length":String(bytes),origin:"https://context-reader.com"}});
  assert.equal(protectApiRequest(request(1_788_008)),null);
  assert.equal(protectApiRequest(request(20*1024*1024+1000)),null);
  assert.equal(protectApiRequest(request(21*1024*1024))?.status,413);
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
