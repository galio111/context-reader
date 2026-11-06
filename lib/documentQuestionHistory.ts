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
    const request = indexedDB.open("context-reader-document-questions-v1", 1);
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
}
