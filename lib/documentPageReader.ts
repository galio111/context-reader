import type { PDFDocumentProxy } from "pdfjs-dist";
import { cacheDocument, readCachedDocument } from "./documentBinaryCache";
import { pdfOptions } from "./documentClient";

export type ReadingPdf = Pick<PDFDocumentProxy, "numPages" | "getPage"> & { getFullPage?: PDFDocumentProxy["getPage"] };
export function createPageReader(library: typeof import("pdfjs-dist"), worker: InstanceType<typeof library.PDFWorker>,
  owner: string | null, id: string, url: string, count: number, signal: AbortSignal) {
  const tasks = new Map<string, ReturnType<typeof library.getDocument>>();
  const pending = new Map<string, ReturnType<PDFDocumentProxy["getPage"]>>();
  const load = (number: number, preview: boolean) => {
    const requestKey = `${number}:${preview}`;
    let result = pending.get(requestKey);
    if (!result) {
      result = (async () => {
          const originalKey = `${id}:page-v1:${number}`;
          const key = preview ? `${id}:page-preview-v1:${number}` : originalKey;
          let bytes = preview ? await readCachedDocument(owner, originalKey) : null;
          bytes ??= await readCachedDocument(owner, key);
          signal.throwIfAborted();
          if (!bytes) {
            for (let attempt = 0; ; attempt++) {
              try {
                const response = await fetch(`${url}&page=${number}${preview ? "&preview=1" : ""}`, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]) });
                if (!response.ok) throw new Error("Page source unavailable");
                bytes = await response.arrayBuffer();
                break;
              } catch (error) {
                if (signal.aborted || attempt >= 1) throw error;
              }
            }
            signal.throwIfAborted();
            void cacheDocument(owner, key, bytes).catch(() => undefined);
          }
          const task = library.getDocument({ data: bytes.slice(0), worker, ...pdfOptions });
          tasks.set(requestKey, task);
          const pdf = await task.promise;
          signal.throwIfAborted();
          return pdf.getPage(1);
      })();
      pending.set(requestKey, result);
      result.catch(() => pending.delete(requestKey));
    }
    return result;
  };
  const reader: ReadingPdf = {
    numPages: count,
    getPage: number => load(number, count <= 24),
    ...(count <= 24 ? { getFullPage: (number: number) => load(number, false) } : {}),
  };
  return { reader, async destroy() { await Promise.allSettled([...tasks.values()].map(task => task.destroy())); } };
}
