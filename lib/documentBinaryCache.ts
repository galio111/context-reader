import { getLearningStorage } from "./learningStorage";
import { isAccountStorageTransition } from "./accountStorageTransition";
import { MAX_DOCUMENT_BYTES } from "./documentSource";

interface CachedDocument { key: string; owner: string; id: string; bytes: ArrayBuffer; touched: number }
const DATABASE = "context-reader-private-documents-v1";
const STORE = "originals";
const MAX_CACHE_BYTES = 2 * MAX_DOCUMENT_BYTES;

export function documentCacheOwner(): string | null {
  try { const storage = getLearningStorage(); return isAccountStorageTransition(storage) ? null : storage.getItem("context-reader:local-account-owner:v1"); }
  catch { return null; }
}

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open(DATABASE,1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error("Document cache unavailable")); }, 1000);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE,{keyPath:"key"});
    request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else { request.result.onversionchange = () => request.result.close(); resolve(request.result); } };
    request.onerror = () => { clearTimeout(timer); reject(request.error); };
  });
}

export async function readCachedDocument(owner: string | null, id: string): Promise<ArrayBuffer | null> {
  if (!owner || documentCacheOwner() !== owner) return null;
  let db: IDBDatabase | undefined;
  try {
    db = await openCache();
    const value = await new Promise<CachedDocument | undefined>((resolve,reject) => {
      const request = db!.transaction(STORE).objectStore(STORE).get(`${owner}:${id}`);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    if (documentCacheOwner() !== owner || value?.owner !== owner || value.id !== id || !value.bytes.byteLength || value.bytes.byteLength > MAX_DOCUMENT_BYTES) return null;
    return value.bytes;
  } catch { return null; }
  finally { db?.close(); }
}

/** Private local cache, never synced or served across owners. Bounded to 100 MB.
 * Cache failures never prevent opening an original from its authenticated route.
 */
export async function cacheDocument(owner: string | null, id: string, bytes: ArrayBuffer): Promise<void> {
  if (!owner || documentCacheOwner() !== owner || !bytes.byteLength || bytes.byteLength > MAX_DOCUMENT_BYTES) return;
  const copy = bytes.slice(0); // PDF.js transfers/detaches its input buffer.
  let db: IDBDatabase | undefined;
  try {
    db = await openCache();
    if (documentCacheOwner() !== owner) return;
    await new Promise<void>((resolve,reject) => {
      const transaction = db!.transaction(STORE,"readwrite"), store = transaction.objectStore(STORE);
      const row: CachedDocument = { key:`${owner}:${id}`,owner,id,bytes:copy,touched:Date.now() };
      store.put(row);
      const request = store.getAll();
      request.onsuccess = () => {
        const rows = (request.result as CachedDocument[]).sort((a,b) => a.touched-b.touched);
        let total = rows.reduce((sum,item)=>sum+item.bytes.byteLength,0);
        for (const item of rows) { if (total <= MAX_CACHE_BYTES) break; store.delete(item.key); total -= item.bytes.byteLength; }
      };
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
  } catch { /* Optional cache; preserve the source and reading flow. */ }
  finally { db?.close(); }
}
