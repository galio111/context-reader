import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDocxImageCrops} from '../lib/docxImageLayout';
import {documentPageTargets,currentDocumentPage,jumpDocumentPage} from '../lib/documentPageNavigation';
import {JSDOM} from 'jsdom';
import JSZip from 'jszip';

test('cropped Word images receive a fixed clipped viewport and absolute crop coordinates instead of overflowing transforms',()=>{
 const image={type:'image',src:'rId1',srcRect:[0,.18242,0,.52276],cssStyle:{width:'388.80pt',height:'165.50pt',position:'relative',top:'0pt'},rotation:0};
 const body={type:'document',children:[{type:'drawing',children:[image]}]};
 assert.equal(normalizeDocxImageCrops({documentPart:{body}}),1);
 const viewport=body.children[0].children[0] as unknown as {type:string;cssStyle:Record<string,string>;children:typeof image[]};
 assert.equal(viewport.cssStyle.overflow,'hidden');assert.equal(viewport.cssStyle.height,'165.50pt');assert.equal(viewport.children[0].srcRect,undefined);
 assert.equal(viewport.children[0].cssStyle.position,'absolute');assert.equal(viewport.children[0].cssStyle.transform,'none');
 const sy=1-.18242-.52276;
 assert.ok(Math.abs(parseFloat(viewport.children[0].cssStyle.top)+100*.18242/sy)<.0001);
 assert.equal(normalizeDocxImageCrops({documentPart:{body}}),0);
});

test('the actual docx-preview parser and renderer use the bounded crop while retaining inline images and text order',async()=>{
 const dom=new JSDOM('',{url:'http://localhost'});Object.assign(globalThis,{window:dom.window,DOMParser:dom.window.DOMParser,Node:dom.window.Node,Element:dom.window.Element,document:dom.window.document});
 const zip=new JSZip();
 zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 zip.file('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pixel.png"/></Relationships>');
 zip.file('word/media/pixel.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0QAAAABJRU5ErkJggg==','base64'));
 zip.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>Before image</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline><wp:extent cx="4937760" cy="2101850"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect t="18242" b="52276"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4937760" cy="2101850"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p><w:p><w:r><w:t>After image</w:t></w:r></w:p></w:body></w:document>`);
 const {parseAsync,renderDocument}=await import('docx-preview');const parsed=await parseAsync(await zip.generateAsync({type:'nodebuffer'}));
 assert.equal(normalizeDocxImageCrops(parsed),1);await renderDocument(parsed,dom.window.document.body,undefined,{useBase64URL:false});
 const img=dom.window.document.querySelector('img')!;const wrapper=img.parentElement!;
 assert.equal(wrapper.style.overflow,'hidden');assert.equal(wrapper.style.height,'165.5pt');assert.equal(img.style.position,'absolute');assert.equal(img.style.clipPath,'');
 assert.ok(dom.window.document.body.textContent!.indexOf('Before image')<dom.window.document.body.textContent!.indexOf('After image'));
 dom.window.close();
});

test('PDF directory retains page order, binary current-page lookup and exact page jumps',()=>{
 const dom=new JSDOM('<div id="root"><section><div data-document-page="1"></div></section><section><div data-document-page="2"></div></section></div>');const root=dom.window.document.getElementById('root')!;let scroll=0;
 const doc=dom.window.document;Object.defineProperty(doc.documentElement,'scrollTop',{get:()=>scroll,set:v=>{scroll=v;}});
 Array.from(root.children).forEach((element,i)=>{(element as HTMLElement).getBoundingClientRect=()=>({top:i*1000-scroll} as DOMRect);});
 const targets=documentPageTargets(root,null);assert.equal(targets.length,2);jumpDocumentPage(targets[1],80);assert.equal(scroll,920);assert.equal(currentDocumentPage(targets,80),2);dom.window.close();
});

test('long Word sections expose reading-page targets through the iframe scale',()=>{
 const dom=new JSDOM('<div id="root"><iframe></iframe></div>');const root=dom.window.document.getElementById('root')!,frame=root.querySelector('iframe')!;
 frame.contentDocument!.body.innerHTML='<section class="docx" style="min-height:750pt"></section>';
 const section=frame.contentDocument!.querySelector('section')!;section.getBoundingClientRect=()=>({top:0,height:3000} as DOMRect);
 Object.defineProperty(frame,'clientWidth',{value:800});frame.getBoundingClientRect=()=>({top:100,width:400} as DOMRect);
 const targets=documentPageTargets(root,frame);assert.equal(targets.length,3);assert.equal(targets[1].top(),600);assert.equal(targets[2].top(),1100);dom.window.close();
});

