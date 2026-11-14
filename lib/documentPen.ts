export interface DocumentPenRect { page: string; x: number; y: number; width: number; height?: number }
export interface DocumentPenMark { id: string; rects: DocumentPenRect[] }
export const DOCUMENT_PEN_PREFIX = "context-reader:document-pen:v1:";
export function documentPenKey(owner: string | null, documentId: string) { return DOCUMENT_PEN_PREFIX + JSON.stringify([owner, documentId]); }
export function readDocumentPenMarks(storage: Pick<Storage,"getItem">, key: string): DocumentPenMark[] {
  const raw = storage.getItem(key);
  if (!raw) return [];
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows) || rows.length > 1000 || rows.some(mark => !mark || typeof mark.id !== "string" || !Array.isArray(mark.rects) || mark.rects.length > 400 || mark.rects.some((r: DocumentPenRect) => !r || typeof r.page !== "string" || ![r.x,r.y,r.width].every(Number.isFinite) || r.x<0 || r.y<0 || r.x>1 || r.y>1 || r.width<=0 || r.width>1 || (r.height!==undefined && (!Number.isFinite(r.height) || r.height<=0 || r.height>1))))) throw Error("Invalid document annotations");
  return rows;
}
export function captureDocumentPenRects(root: HTMLElement): DocumentPenRect[] {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return [];
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return [];
  const pages = documentPenPages(root);
  const result: DocumentPenRect[] = [];
  for (const rect of Array.from(range.getClientRects())) {
    if (rect.width < 1 || rect.height < 1) continue;
    for (const {key,element} of pages) {
      const bounds=element.getBoundingClientRect();
      const x=Math.max(rect.left,bounds.left), end=Math.min(rect.right,bounds.right);
      if (!bounds.width || !bounds.height || rect.height>bounds.height*.08 || end<=x || rect.top<bounds.top-1 || rect.bottom>bounds.bottom+1) continue;
      const item={page:key,x:(x-bounds.left)/bounds.width,y:Math.min(1,Math.max(0,(rect.bottom-bounds.top-1)/bounds.height)),width:(end-x)/bounds.width,height:rect.height/bounds.height};
      if (!result.some(r=>r.page===item.page && Math.abs(r.x-item.x)<.001 && Math.abs(r.y-item.y)<.002 && Math.abs(r.width-item.width)<.001)) result.push(item);
      break;
    }
    if(result.length>=400)break;
  }
  return mergeDocumentPenRects(result);
}
export function documentPenPages(root: HTMLElement) {
  const pdf=Array.from(root.querySelectorAll<HTMLElement>("[data-document-page]"));
  if(pdf.length)return pdf.map(node=>({key:`pdf:${node.dataset.documentPage}`,element:node.parentElement!}));
  return Array.from(root.querySelectorAll<HTMLElement>("section.docx")).map((element,index)=>({key:`word:${index}`,element}));
}
export function paintDocumentPen(root: HTMLElement, marks: DocumentPenMark[]) {
  root.querySelectorAll("[data-document-pen-layer]").forEach(node=>node.remove());
  const grouped=new Map<string,DocumentPenRect[]>();
  for(const mark of marks)for(const rect of mergeDocumentPenRects(mark.rects)){const rows=grouped.get(rect.page)??[];rows.push(rect);grouped.set(rect.page,rows);}
  for(const {key,element} of documentPenPages(root)) {
    const rows=grouped.get(key);if(!rows?.length)continue;
    element.style.position="relative";
    const layer=root.ownerDocument.createElement("div");layer.dataset.documentPenLayer="";layer.setAttribute("aria-hidden","true");
    Object.assign(layer.style,{position:"absolute",inset:"0",pointerEvents:"none",zIndex:"3"});
    for(const rect of rows){const line=root.ownerDocument.createElement("i");Object.assign(line.style,{position:"absolute",left:`${rect.x*100}%`,top:`${rect.y*100}%`,width:`${rect.width*100}%`,height:"2px",background:"#b63832",borderRadius:"1px"});layer.append(line);}
    element.append(layer);
  }
}

/** Merge glyph/run fragments within one stroke, never across pages or columns.
 * Legacy marks lack height: use a conservative page-relative baseline tolerance.
 * Paint-time projection repairs old marks without rewriting durable records.
 */
export function mergeDocumentPenRects(rects: readonly DocumentPenRect[]): DocumentPenRect[] {
  const rows: DocumentPenRect[][]=[];
  for(const rect of [...rects].sort((a,b)=>a.page.localeCompare(b.page)||a.y-b.y||a.x-b.x)) {
    const row=rows.find(items=>items[0].page===rect.page && Math.abs(items[0].y-rect.y)<=Math.min(.008,Math.max(items[0].height??.012,rect.height??.012)*.55));
    if(row)row.push(rect);else rows.push([rect]);
  }
  const result:DocumentPenRect[]=[];
  for(const row of rows){
    let line:DocumentPenRect|undefined;
    for(const rect of row.sort((a,b)=>a.x-b.x)){
      if(line && rect.x<=line.x+line.width+.02){line.width=Math.max(line.x+line.width,rect.x+rect.width)-line.x;line.y=Math.max(line.y,rect.y);}
      else {line={...rect};result.push(line);}
    }
  }
  return result;
}
