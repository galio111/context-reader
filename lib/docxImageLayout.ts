interface DocxNode { type?: string; children?: DocxNode[]; cssStyle?: Record<string,string>; srcRect?: number[]; rotation?: number; [key:string]:unknown }
interface DocxParsed { documentPart?: {body?:DocxNode}; parts?: {body?:DocxNode;rootElement?:DocxNode}[] }
/** docx-preview 0.3.7 scales a cropped image around its centre without a
 * containing viewport. Word crops must stay inside their reserved drawing box.
 * Only the parsed render projection changes; original ZIP and source stay intact.
 */
export function normalizeDocxImageCrops(document:DocxParsed):number {
 let count=0;const seen=new WeakSet<object>();
 function visit(node:DocxNode|undefined){
  if(!node || seen.has(node))return;seen.add(node);
  node.children=node.children?.map(child=>{
   if(child.type!=='image' || !child.srcRect?.some(n=>n!==0)){visit(child);return child;}
   const [left,top,right,bottom]=child.srcRect;
   const sx=1-left-right,sy=1-top-bottom;
   const style=child.cssStyle;
   if(!style?.width || !style.height || ![left,top,right,bottom].every(Number.isFinite) || sx<=.001 || sy<=.001)return child;
   const image:DocxNode={...child,srcRect:undefined,rotation:0,cssStyle:{...style,position:'absolute',left:`${-100*left/sx}%`,top:`${-100*top/sy}%`,width:`${100/sx}%`,height:`${100/sy}%`,transform:'none'}};
   const wrapper:DocxNode={type:'drawing',cssStyle:{position:'relative',display:'inline-block',overflow:'hidden','vertical-align':'top',width:style.width,height:style.height,...(child.rotation?{transform:`rotate(${child.rotation}deg)`}:{})},children:[image]};
   count++;return wrapper;
  });
 }
 visit(document.documentPart?.body);for(const part of document.parts??[]){visit(part.body);visit(part.rootElement);}
 return count;
}
