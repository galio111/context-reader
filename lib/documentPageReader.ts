import type { PDFDocumentProxy } from "pdfjs-dist";
import { cacheDocument, readCachedDocument } from "./documentBinaryCache";
import { pdfOptions } from "./documentClient";

export type ReadingPdf = Pick<PDFDocumentProxy, "numPages" | "getPage">;
export function createPageReader(library: typeof import("pdfjs-dist"), worker: InstanceType<typeof library.PDFWorker>,
  owner: string | null, id: string, url: string, count: number, signal: AbortSignal) {
  const tasks = new Map<number, ReturnType<typeof library.getDocument>>();
  const pending = new Map<number, ReturnType<PDFDocumentProxy["getPage"]>>();
  const reader: ReadingPdf = {
    numPages: count,
    getPage(number) {
      let result = pending.get(number);
      if (!result) {
        result = (async () => {
          const key = `${id}:page-v1:${number}`;
          let bytes = await readCachedDocument(owner, key);
          signal.throwIfAborted();
          if (!bytes) {
            const response = await fetch(`${url}&page=${number}`, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
            if (!response.ok) throw new Error("Page source unavailable");
            bytes = await response.arrayBuffer();
            signal.throwIfAborted();
            // Cache and PDF worker each own their bytes, including on refresh.
            void cacheDocument(owner, key, bytes).catch(() => undefined);
          }
          const task = library.getDocument({ data: bytes.slice(0), worker, ...pdfOptions });
          tasks.set(number, task);
          const pdf = await task.promise;
          signal.throwIfAborted();
          return pdf.getPage(1);
        })();
        pending.set(number, result);
        result.catch(() => pending.delete(number));
      }
      return result;
    },
  };
  return { reader, async destroy() { await Promise.allSettled([...tasks.values()].map(task => task.destroy())); } };
}
