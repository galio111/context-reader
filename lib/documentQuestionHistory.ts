import { notifyAccountDataChanged } from "./accountEvents";
import type { AccountSyncObject } from "../types/account";

export const DOCUMENT_QUESTION_PREFIX = "document-question:v1:";
export const DOCUMENT_QUESTION_EVENT = "context-reader:document-question-history";
export interface DocumentQuestionTurn {
  id: string;
  createdAt: string;
  question: string;
  answer: string;
  sources?: { title: string; url: string }[];
  notice?: string;
}

// A separate durable store: account switching never reassigns a paper's conversation.
function openHistory(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const factory = globalThis.indexedDB ?? (typeof window !== "undefined" ? window.indexedDB : undefined);
    if (!factory) { reject(new Error("Document history storage unavailable")); return; }
    const request = factory.open("context-reader-document-questions-v1", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("turns", { keyPath: ["scope", "id"] }).createIndex("scope", "scope");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function documentQuestionScope(owner: string, documentId: string): string {
  return JSON.stringify([owner, documentId]);
}
export async function readDocumentQuestions(scope: string): Promise<DocumentQuestionTurn[]> {
  const db = await openHistory();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("turns", "readonly");
      const request = tx.objectStore("turns").index("scope").getAll(scope);
      tx.oncomplete = () => resolve(request.result.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function saveDocumentQuestion(scope: string, turn: DocumentQuestionTurn): Promise<void> {
  const db = await openHistory();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("turns", "readwrite");
      tx.objectStore("turns").put({ ...turn, scope });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
  changed(scope);
  notifyAccountDataChanged(["preferences"]);
}

function changed(scope?: string): void {
  if(typeof window!=="undefined")window.dispatchEvent(new window.CustomEvent(DOCUMENT_QUESTION_EVENT,{detail:{scope}}));
}
export interface DocumentQuestionRecord { documentId:string; turn:DocumentQuestionTurn }
export function documentQuestionObjectKey(record:DocumentQuestionRecord):string {
  return DOCUMENT_QUESTION_PREFIX+encodeURIComponent(record.documentId)+":"+encodeURIComponent(record.turn.id);
}
export function normalizeDocumentQuestionRecord(value:unknown):DocumentQuestionRecord|null {
  const record=value as Partial<DocumentQuestionRecord>;
  const t=record?.turn;
  if(typeof record?.documentId!=="string" || !record.documentId || record.documentId.length>160
    || !t || typeof t.id!=="string" || !t.id || t.id.length>100
    || typeof t.question!=="string" || !t.question.trim() || t.question.length>1000
    || typeof t.answer!=="string" || !t.answer.trim() || t.answer.length>20000
    || typeof t.createdAt!=="string" || t.createdAt.length>40 || !Number.isFinite(Date.parse(t.createdAt))
    || (t.notice!==undefined && (typeof t.notice!=="string" || t.notice.length>2000))
    || (t.sources!==undefined && (!Array.isArray(t.sources) || t.sources.length>10 || t.sources.some(s=>{
      if(typeof s?.title!=="string" || s.title.length>1000 || typeof s.url!=="string" || s.url.length>2000)return true;
      try{return !["https:","http:"].includes(new URL(s.url).protocol);}catch{return true;}
    }))))return null;
  const result:DocumentQuestionRecord={documentId:record.documentId,turn:{id:t.id,createdAt:t.createdAt,question:t.question,answer:t.answer,
    ...(t.sources ? {sources:t.sources.map(s=>({title:s.title,url:s.url}))}:{}),...(t.notice!==undefined?{notice:t.notice}:{})}};
  return documentQuestionObjectKey(result).length<=500 ? result : null;
}
/** Existing local-only rows are already owner-scoped: read and upload without moving or deleting them. */
export async function readOwnerDocumentQuestions(owner:string):Promise<DocumentQuestionRecord[]> {
  if(!owner || owner==="guest")return [];
  const db=await openHistory();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction("turns","readonly");const req=tx.objectStore("turns").getAll();
      tx.oncomplete=()=>{
        const result:DocumentQuestionRecord[]=[];
        for(const row of req.result){
          try{const [rowOwner,documentId]=JSON.parse(row.scope);if(rowOwner!==owner)continue;
            const record=normalizeDocumentQuestionRecord({documentId,turn:row});if(record)result.push(record);
          }catch{ /* Keep unrecognized legacy rows locally. */ }
        }
        resolve(result);
      };
      tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }finally{db.close();}
}
export async function mergeDocumentQuestionObjects(owner:string,objects:AccountSyncObject[]):Promise<void> {
  const rows=objects.filter(o=>o.kind==="preferences" && o.objectKey.startsWith(DOCUMENT_QUESTION_PREFIX));
  if(!owner || owner==="guest" || !rows.length)return;
  const db=await openHistory();
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction("turns","readwrite");const store=tx.objectStore("turns");
      for(const object of rows){
        if(object.deletedAt){
          try{
            const ids=object.objectKey.slice(DOCUMENT_QUESTION_PREFIX.length).split(":").map(decodeURIComponent);
            if(ids.length===2 && documentQuestionObjectKey({documentId:ids[0],turn:{id:ids[1]} as DocumentQuestionTurn})===object.objectKey)
              store.delete([documentQuestionScope(owner,ids[0]),ids[1]]);
          }catch{ /* Invalid key cannot address a local row. */ }
        }else{
          const record=normalizeDocumentQuestionRecord(object.payload);
          if(record && documentQuestionObjectKey(record)===object.objectKey)
            store.put({...record.turn,scope:documentQuestionScope(owner,record.documentId)});
        }
      }
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }finally{db.close();}
  changed(); // Refresh open panels; cloud replay never marks a new local edit.
}
