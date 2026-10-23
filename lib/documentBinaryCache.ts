import { getLearningStorage } from "./learningStorage";
import { isAccountStorageTransition } from "./accountStorageTransition";
import { MAX_DOCUMENT_BYTES } from "./documentSource";

interface CachedDocument { key: string; owner: string; id: string; bytes: ArrayBuffer; touched: number }
const DATABASE = "context-reader-private-documents-v1";
const STORE = "originals";
const META = "sizes";
const MAX_CACHE_BYTES = 1024 * 1024 * 1024;
const MAX_MEMORY_BYTES = 128 * 1024 * 1024;
// Keep an immediately readable copy while IndexedDB commits and across reopen.
// Return copies: PDF.js transfers (detaches) its input buffer.
const memory = new Map<string, ArrayBuffer>();
let memoryBytes = 0;
function remember(owner: string, id: string, bytes: ArrayBuffer) {
  const key = `${owner}:${id}`;
  memoryBytes -= memory.get(key)?.byteLength ?? 0;
  memory.delete(key);
  memory.set(key, bytes.slice(0)); memoryBytes += bytes.byteLength;
  for (const [oldKey, oldBytes] of memory) {
    if (memoryBytes <= MAX_MEMORY_BYTES) break;
    memory.delete(oldKey); memoryBytes -= oldBytes.byteLength;
  }
}

export function documentCacheOwner(): string | null {
  try { const storage = getLearningStorage(); return isAccountStorageTransition(storage) ? null : storage.getItem("context-reader:local-account-owner:v1"); }
  catch { return null; }
}

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open(DATABASE,2);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error("Document cache unavailable")); }, 1000);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE,{keyPath:"key"});
      if (!database.objectStoreNames.contains(META)) {
        const sizes = database.createObjectStore(META,{keyPath:"key"});
        const cursor = request.transaction!.objectStore(STORE).openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (row) { const value = row.value as CachedDocument; sizes.put({key:value.key,size:value.bytes.byteLength,touched:value.touched}); row.continue(); }
        };
      }
    };
    request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else { request.result.onversionchange = () => request.result.close(); resolve(request.result); } };
    request.onerror = () => { clearTimeout(timer); reject(request.error); };
  });
}

export async function readCachedDocument(owner: string | null, id: string): Promise<ArrayBuffer | null> {
  if (!owner || documentCacheOwner() !== owner) return null;
  const resident = memory.get(`${owner}:${id}`);
  if (resident) { memory.delete(`${owner}:${id}`); memory.set(`${owner}:${id}`, resident); return resident.slice(0); }
  let db: IDBDatabase | undefined;
  try {
    db = await openCache();
    const value = await new Promise<CachedDocument | undefined>((resolve,reject) => {
      const request = db!.transaction(STORE).objectStore(STORE).get(`${owner}:${id}`);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    if (documentCacheOwner() !== owner || value?.owner !== owner || value.id !== id || !value.bytes.byteLength || value.bytes.byteLength > MAX_DOCUMENT_BYTES) return null;
    remember(owner, id, value.bytes);
    return value.bytes;
  } catch { return null; }
  finally { db?.close(); }
}

/** Private local cache, never synced or served across owners. Bounded to 1 GiB on disk and 128 MiB in memory.
 * Cache failures never prevent opening an original from its authenticated route.
 */
export async function cacheDocument(owner: string | null, id: string, bytes: ArrayBuffer): Promise<void> {
  if (!owner || documentCacheOwner() !== owner || !bytes.byteLength || bytes.byteLength > MAX_DOCUMENT_BYTES) return;
  remember(owner, id, bytes);
  const copy = bytes.slice(0); // PDF.js transfers/detaches its input buffer.
  let db: IDBDatabase | undefined;
  try {
    db = await openCache();
    if (documentCacheOwner() !== owner) return;
    await new Promise<void>((resolve,reject) => {
      const transaction = db!.transaction([STORE,META],"readwrite"), store = transaction.objectStore(STORE), sizes = transaction.objectStore(META);
      const row: CachedDocument = { key:`${owner}:${id}`,owner,id,bytes:copy,touched:Date.now() };
      store.put(row);
      sizes.put({key:row.key,size:copy.byteLength,touched:row.touched});
      const request = sizes.getAll();
      request.onsuccess = () => {
        const rows = (request.result as {key:string;size:number;touched:number}[]).sort((a,b) => a.touched-b.touched);
        let total = rows.reduce((sum,item)=>sum+item.size,0);
        for (const item of rows) { if (total <= MAX_CACHE_BYTES) break; store.delete(item.key); sizes.delete(item.key); total -= item.size; }
      };
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
  } catch { /* Optional cache; preserve the source and reading flow. */ }
  finally { db?.close(); }
}
