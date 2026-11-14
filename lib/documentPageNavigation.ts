export interface DocumentPageTarget { key:string; top:()=>number; scrollHost:HTMLElement }
function scrollHost(root:HTMLElement):HTMLElement {
 const win=root.ownerDocument.defaultView!;
 for(let n=root.parentElement;n&&n!==root.ownerDocument.body;n=n.parentElement)if(/auto|scroll/.test(win.getComputedStyle(n).overflowY)&&n.scrollHeight>n.clientHeight+1)return n;
 return (root.ownerDocument.scrollingElement??root.ownerDocument.documentElement) as HTMLElement;
}
function pixels(value:string){const n=parseFloat(value);return Number.isFinite(n)?n*(value.endsWith('pt')?96/72:value.endsWith('in')?96:1):0;}
export function documentPageTargets(root:HTMLElement,frame:HTMLIFrameElement|null):DocumentPageTarget[]{
 const host=scrollHost(root);
 const pdf=Array.from(root.querySelectorAll<HTMLElement>('[data-document-page]'));
 if(pdf.length)return pdf.map(node=>({key:`pdf:${node.dataset.documentPage}`,top:()=>node.parentElement!.getBoundingClientRect().top,scrollHost:host}));
 const doc=frame?.contentDocument;if(!frame||!doc)return [];
 const pages:DocumentPageTarget[]=[];
 Array.from(doc.querySelectorAll<HTMLElement>('section.docx')).forEach((section,index)=>{
  const paper=pixels(doc.defaultView!.getComputedStyle(section).minHeight)||1122.52;
  const count=Math.max(1,Math.ceil((section.getBoundingClientRect().height-1)/paper));
  for(let part=0;part<count&&pages.length<2000;part++)pages.push({key:`word:${index}:${part}`,scrollHost:host,top:()=>{
   const scale=frame.clientWidth?frame.getBoundingClientRect().width/frame.clientWidth:1;
   return frame.getBoundingClientRect().top+(section.getBoundingClientRect().top+part*paper)*scale;
  }});
 });
 return pages;
}
export function currentDocumentPage(pages:DocumentPageTarget[],edge:number){
 let lo=0,hi=pages.length-1,result=0;
 while(lo<=hi){const mid=(lo+hi)>>1;if(pages[mid].top()<=edge+2){result=mid;lo=mid+1;}else hi=mid-1;}
 return result+1;
}
export function jumpDocumentPage(target:DocumentPageTarget,edge:number){target.scrollHost.scrollTop+=target.top()-edge;}
