export interface DocumentZoomAnchor {
  element: HTMLElement;
  x: number; y: number;
  screenX: number; screenY: number;
  vertical: HTMLElement;
}
export function captureDocumentZoomAnchor(root: HTMLElement, scroller: HTMLElement): DocumentZoomAnchor | null {
  const doc=root.ownerDocument, win=doc.defaultView!;
  const visibleTop=Math.max(0,root.getBoundingClientRect().top);
  const toolbar=Array.from(doc.querySelectorAll<HTMLElement>('[data-document-toolbar]')).find(e=>e.getBoundingClientRect().bottom>visibleTop);
  const top=Math.max(visibleTop,toolbar?.getBoundingClientRect().bottom??0);
  const bottom=Math.min(win.innerHeight,root.getBoundingClientRect().bottom);
  const target=top+Math.max(0,bottom-top)*.35;
  const pages=Array.from(scroller.querySelectorAll<HTMLElement>('[data-document-page]')).map(e=>e.parentElement!);
  if(!pages.length){const word=scroller.querySelector<HTMLElement>('[data-document-word-viewport]');if(word)pages.push(word);}
  const element=pages.find(e=>{const b=e.getBoundingClientRect();return b.top<=target&&b.bottom>=target;})??pages.find(e=>e.getBoundingClientRect().bottom>top);
  if(!element)return null;
  const bounds=element.getBoundingClientRect(), viewport=scroller.getBoundingClientRect();
  if(!bounds.width||!bounds.height)return null;
  const screenY=Math.min(bounds.bottom,Math.max(bounds.top,target));
  const screenX=Math.min(bounds.right,Math.max(bounds.left,viewport.left+Math.min(viewport.width,win.innerWidth-viewport.left)*.5));
  let vertical:HTMLElement=(doc.scrollingElement??doc.documentElement) as HTMLElement;
  for(let node=scroller.parentElement;node && node!==doc.body;node=node.parentElement){
    if(/auto|scroll/.test(win.getComputedStyle(node).overflowY)&&node.scrollHeight>node.clientHeight+1){vertical=node;break;}
  }
  return {element,x:(screenX-bounds.left)/bounds.width,y:(screenY-bounds.top)/bounds.height,screenX,screenY,vertical};
}
export function restoreDocumentZoomAnchor(anchor:DocumentZoomAnchor,scroller:HTMLElement) {
  if(!anchor.element.isConnected)return;
  const bounds=anchor.element.getBoundingClientRect();
  const dx=bounds.left+anchor.x*bounds.width-anchor.screenX;
  const dy=bounds.top+anchor.y*bounds.height-anchor.screenY;
  if(Math.abs(dx)>.5)scroller.scrollLeft+=dx;
  if(Math.abs(dy)>.5)anchor.vertical.scrollTop+=dy;
}
