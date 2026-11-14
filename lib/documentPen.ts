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
  // A parent Range also returns element boxes, including duplicate boxes for
  // nested PDF runs. Measure only the selected leaf text, using PDF baselines.
  const fragments: {rect: DOMRect; baseline?: number; height?: number}[] = [];
  if (root.querySelector(".textLayer")) {
    const walker = root.ownerDocument.createTreeWalker(root, 4);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!node.data.trim() || !node.parentElement?.closest(".textLayer") || !range.intersectsNode(node)) continue;
      const part = range.cloneRange();
      part.selectNodeContents(node);
      if (range.compareBoundaryPoints(0, part) > 0) part.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(2, part) < 0) part.setEnd(range.endContainer, range.endOffset);
      if (part.collapsed) continue;
      const run = pdfPenRun(node.parentElement);
      for (const rect of Array.from(part.getClientRects())) fragments.push({rect, baseline:run?.baseline, height:run?.height});
      if (fragments.length >= 400) break;
    }
  } else for (const rect of Array.from(range.getClientRects())) fragments.push({rect});
  for (const {rect,baseline,height} of fragments) {
    if (rect.width < 1 || rect.height < 1) continue;
    for (const {key,element} of pages) {
      const bounds=element.getBoundingClientRect();
      const x=Math.max(rect.left,bounds.left), end=Math.min(rect.right,bounds.right);
      if (!bounds.width || !bounds.height || rect.height>bounds.height*.08 || end<=x || rect.top<bounds.top-1 || rect.bottom>bounds.bottom+1) continue;
      const item={page:key,x:(x-bounds.left)/bounds.width,y:Math.min(1,Math.max(0,((baseline === undefined ? rect.bottom-1 : baseline+1)-bounds.top)/bounds.height)),width:(end-x)/bounds.width,height:(height??rect.height)/bounds.height};
      if (!result.some(r=>r.page===item.page && Math.abs(r.x-item.x)<.001 && Math.abs(r.y-item.y)<.002 && Math.abs(r.width-item.width)<.001)) result.push(item);
      break;
    }
    if(result.length>=400)break;
  }
  return mergeDocumentPenRects(result);
}

function pdfPenRun(element: HTMLElement) {
  const layer = element.closest<HTMLElement>("[data-pdf-viewport]");
  const viewport = layer?.dataset.pdfViewport?.split(",").map(Number);
  const geometry = element.closest<HTMLElement>("[data-pdf-run]")?.dataset.pdfRun?.split(",").map(Number);
  if (!layer || layer.style.visibility === "hidden" || !viewport || !geometry || ![...viewport,...geometry].every(Number.isFinite) || viewport[0]<=0 || viewport[1]<=0) return null;
  const bounds = layer.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  return {left:bounds.left+geometry[0]*bounds.width/viewport[0],width:geometry[2]*bounds.width/viewport[0],baseline:bounds.top+geometry[1]*bounds.height/viewport[1],height:geometry[3]*bounds.height/viewport[1]};
}

/** Project legacy font-box bottoms onto native baselines without editing storage. */
function alignPdfPenRects(element: HTMLElement, rects: DocumentPenRect[]) {
  const bounds = element.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return rects;
  const runs = Array.from(element.querySelectorAll<HTMLElement>("[data-pdf-run]"))
    .map(pdfPenRun).filter(run => run !== null);
  if (!runs.length) return rects;
  return rects.map(rect => {
    const left=bounds.left+rect.x*bounds.width, right=left+rect.width*bounds.width;
    const bottom=bounds.top+rect.y*bounds.height;
    let closest: typeof runs[number] | undefined, distance=Infinity;
    for (const run of runs) {
      const dy=Math.abs(run.baseline+1-bottom);
      if (run.left>=right || run.left+run.width<=left || dy>run.height*.65+1 || dy>=distance) continue;
      closest=run;distance=dy;
    }
    return closest ? {...rect,y:Math.min(1,Math.max(0,(closest.baseline+1-bounds.top)/bounds.height)),height:closest.height/bounds.height} : rect;
  });
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
    const stored=grouped.get(key);if(!stored?.length)continue;
    // Union overlapping strokes only in the display. Undo retains every stroke,
    // and separate selections with a real gap must not acquire a connecting line.
    const rows=mergeDocumentPenRects(alignPdfPenRects(element,stored),0);
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
export function mergeDocumentPenRects(rects: readonly DocumentPenRect[], gap = .02): DocumentPenRect[] {
  const rows: DocumentPenRect[][]=[];
  for(const rect of [...rects].sort((a,b)=>a.page.localeCompare(b.page)||a.y-b.y||a.x-b.x)) {
    const row=rows.find(items=>items[0].page===rect.page && Math.abs(items[0].y-rect.y)<=Math.min(.008,Math.max(items[0].height??.012,rect.height??.012)*.55));
    if(row)row.push(rect);else rows.push([rect]);
  }
  const result:DocumentPenRect[]=[];
  for(const row of rows){
    const baseline=Math.max(...row.map(rect=>rect.y));
    let line:DocumentPenRect|undefined;
    for(const rect of row.sort((a,b)=>a.x-b.x)){
      if(line && rect.x<=line.x+line.width+gap+1e-8){line.width=Math.max(line.x+line.width,rect.x+rect.width)-line.x;}
      else {line={...rect,y:baseline};result.push(line);}
    }
  }
  return result;
}
