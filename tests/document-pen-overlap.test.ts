import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {captureDocumentPenRects,paintDocumentPen} from '../lib/documentPen';

const box=(left:number,top:number,width:number,height:number)=>({left,top,width,height,right:left+width,bottom:top+height} as DOMRect);
function fixture(scale=1) {
  const dom=new JSDOM('<div id="root"><section><div data-document-page="1"><div class="textLayer" data-pdf-viewport="1000,1000"><span data-pdf-run="100,150,200,30">abcdefghij</span><span data-pdf-run="320,150,100,30"><span>klmno</span></span><span data-pdf-run="100,210,200,30">pqrstuvwxy</span></div></div></section></div>');
  const doc=dom.window.document,root=doc.getElementById('root')!,page=root.querySelector('section')!,layer=root.querySelector<HTMLElement>('.textLayer')!;
  page.getBoundingClientRect=()=>box(10,20,1000*scale,1000*scale);
  layer.getBoundingClientRect=page.getBoundingClientRect;
  return {dom,doc,root,page,layer};
}

test('native PDF capture measures selected leaf ranges, preserves exact ends and unifies mixed font boxes',()=>{
  const {dom,doc,root,layer}=fixture();
  const nodes=Array.from(layer.querySelectorAll('[data-pdf-run]')).map(el=>el.textContent==='klmno'?el.firstChild!.firstChild!:el.firstChild!);
  const measured:string[]=[];
  Object.assign(dom.window.Range.prototype,{getClientRects:function(this:Range){
    assert.equal(this.startContainer,this.endContainer,'parent/element boxes must not be measured');
    const index=nodes.indexOf(this.startContainer);assert.ok(index>=0);
    measured.push(`${index}:${this.startOffset}:${this.endOffset}`);
    const left=index===1?330:110,top=index===1?130:index===2?200:140;
    return [box(left+this.startOffset*20,top,(this.endOffset-this.startOffset)*20,index===1?42:30)];
  }});
  const range=doc.createRange();range.setStart(nodes[0],4);range.setEnd(nodes[2],3);
  doc.getSelection()!.addRange(range);
  const rects=captureDocumentPenRects(root);
  assert.deepEqual(measured,['0:4:10','1:0:5','2:0:3']);
  assert.equal(rects.length,2);
  assert.equal(rects[0].x,.18);assert.ok(Math.abs(rects[0].width-.24)<1e-8);
  assert.equal(rects[0].y,.151);assert.equal(rects[1].y,.211);
  assert.equal(rects[1].x,.1);assert.equal(rects[1].width,.06);
  dom.window.close();
});

for(const scale of [1,2])test(`legacy overlapping strokes render once on native baselines at scale ${scale}; undo and gaps survive`,()=>{
  const {dom,root}=fixture(scale);
  const marks=[
    {id:'first',rects:[{page:'pdf:1',x:.1,y:.153,width:.2,height:.03},{page:'pdf:1',x:.1,y:.213,width:.1,height:.03}]},
    {id:'repeat',rects:[{page:'pdf:1',x:.1,y:.163,width:.2,height:.03}]},
    {id:'extension',rects:[{page:'pdf:1',x:.2,y:.16,width:.22,height:.03}]},
    {id:'separate',rects:[{page:'pdf:1',x:.44,y:.151,width:.03,height:.03}]},
  ];
  const stored=JSON.stringify(marks);
  paintDocumentPen(root,marks);
  let lines=Array.from(root.querySelectorAll<HTMLElement>('[data-document-pen-layer] i'));
  assert.equal(lines.length,3);assert.ok(Math.abs(parseFloat(lines[0].style.top)-15.1)<.06);assert.ok(Math.abs(parseFloat(lines[0].style.width)-32)<1e-8);
  assert.equal(lines[1].style.left,'44%');assert.equal(lines[1].style.top,lines[0].style.top);
  assert.ok(Math.abs(parseFloat(lines[2].style.top)-(21+.1/scale))<1e-8);
  assert.equal(JSON.stringify(marks),stored,'display must not rewrite durable strokes');
  paintDocumentPen(root,marks.slice(0,2));
  lines=Array.from(root.querySelectorAll<HTMLElement>('[data-document-pen-layer] i'));
  assert.equal(lines.length,2);assert.ok(Math.abs(parseFloat(lines[0].style.width)-20)<1e-8);
  paintDocumentPen(root,[]);assert.equal(root.querySelectorAll('[data-document-pen-layer]').length,0);
  dom.window.close();
});
