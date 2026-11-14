import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mergeDocumentPenRects,paintDocumentPen} from '../lib/documentPen';
import {captureDocumentZoomAnchor,restoreDocumentZoomAnchor} from '../lib/documentZoomAnchor';

test('hyphen and font-height fragments form one underline; other lines, columns, pages and strokes stay separate',()=>{
 const old=[{page:'pdf:1',x:.1,y:.15,width:.04},{page:'pdf:1',x:.14,y:.146,width:.015},{page:'pdf:1',x:.155,y:.15,width:.04}];
 const before=JSON.stringify(old);const lines=mergeDocumentPenRects(old);
 assert.equal(lines.length,1);assert.equal(lines[0].y,.15);assert.ok(Math.abs(lines[0].width-.095)<1e-8);assert.equal(JSON.stringify(old),before);
 assert.equal(mergeDocumentPenRects([...old,{page:'pdf:1',x:.1,y:.18,width:.1},{page:'pdf:1',x:.6,y:.15,width:.1},{page:'pdf:2',x:.1,y:.15,width:.1}]).length,4);
 const dom=new JSDOM('<div id="root"><section><div data-document-page="1"></div></section></div>');const root=dom.window.document.getElementById('root')!;
 paintDocumentPen(root,[{id:'one',rects:old},{id:'two',rects:[{page:'pdf:1',x:.21,y:.15,width:.04}]}]);
 assert.equal(root.querySelectorAll('[data-document-pen-layer] i').length,2);dom.window.close();
});

for(const word of [false,true])test(`${word?'Word':'PDF'} zoom keeps the visible page point through repeated and delayed layout changes`,()=>{
 const dom=new JSDOM('<div id="outer" style="overflow-y:auto"><div id="root"><div data-document-toolbar></div><div id="scroll"><section id="page"><div data-document-page="3"></div></section></div></div></div>',{pretendToBeVisual:true});
 const doc=dom.window.document,outer=doc.getElementById('outer')!,root=doc.getElementById('root')!,scroll=doc.getElementById('scroll')!,page=doc.getElementById('page')!;
 if(word){page.setAttribute('data-document-word-viewport','');page.querySelector('div')!.removeAttribute('data-document-page');}
 Object.defineProperties(outer,{scrollHeight:{value:4000},clientHeight:{value:800}});
 Object.defineProperty(dom.window,'innerHeight',{value:800});
 let scale=1,late=0;outer.scrollTop=1000;scroll.scrollLeft=50;
 const rect=(left:number,top:number,width:number,height:number)=>({left,top,width,height,right:left+width,bottom:top+height} as DOMRect);
 root.getBoundingClientRect=()=>rect(0,-100,600,4000);
 scroll.getBoundingClientRect=()=>rect(0,-100,600,4000);
 root.querySelector<HTMLElement>('[data-document-toolbar]')!.getBoundingClientRect=()=>rect(0,0,600,80);
 page.getBoundingClientRect=()=>rect(100-scroll.scrollLeft,1200*scale+late-outer.scrollTop,600*scale,1000*scale);
 const anchor=captureDocumentZoomAnchor(root,scroll)!;assert.ok(anchor);assert.equal(anchor.element,page);
 scale=2;restoreDocumentZoomAnchor(anchor,scroll);
 let bounds=page.getBoundingClientRect();assert.ok(Math.abs(bounds.top+anchor.y*bounds.height-anchor.screenY)<.01);assert.ok(Math.abs(bounds.left+anchor.x*bounds.width-anchor.screenX)<.01);
 late=140;restoreDocumentZoomAnchor(anchor,scroll);bounds=page.getBoundingClientRect();assert.ok(Math.abs(bounds.top+anchor.y*bounds.height-anchor.screenY)<.01);
 const second=captureDocumentZoomAnchor(root,scroll)!;scale=.75;restoreDocumentZoomAnchor(second,scroll);bounds=page.getBoundingClientRect();assert.ok(Math.abs(bounds.top+second.y*bounds.height-second.screenY)<.01);
 dom.window.close();
});
