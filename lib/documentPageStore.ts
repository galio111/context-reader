import { PDFDocument } from "pdf-lib";
import { DOCUMENT_BUCKET, documentStore } from "./documentStore";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENT_PAGES } from "./documentSource";

// Derived reading pages are disposable. The authenticated original is never
// modified; downloads, forms and unsupported catalog features use that original.
const originals = new Map<string, Promise<PDFDocument>>();
const pages = new Map<string, Uint8Array>();
const pending = new Map<string, Promise<Uint8Array>>();
let cachedBytes = 0;
export async function copyReadingPage(source: PDFDocument, number: number): Promise<Uint8Array> {
  const { PDFName } = await import("pdf-lib");
  if (source.catalog.has(PDFName.of("AcroForm")) || source.catalog.has(PDFName.of("OCProperties"))
    || source.catalog.has(PDFName.of("OutputIntents"))) throw new Error("Original document required");
  if (!Number.isInteger(number) || number < 1 || number > source.getPageCount() || source.getPageCount() > MAX_DOCUMENT_PAGES) throw new Error("Invalid page");
  const target = await PDFDocument.create();
  const [page] = await target.copyPages(source, [number - 1]);
  target.addPage(page);
  return target.save();
}
export async function readDocumentPage(owner: string, id: string, number: number): Promise<Uint8Array> {
  const key = `${owner}/${id}`, pageKey = `${key}/${number}`;
  const cached = pages.get(pageKey);
  if (cached) { pages.delete(pageKey); pages.set(pageKey, cached); return cached; }
  const existing = pending.get(pageKey);
  if (existing) return existing;
  const job = (async () => {
    let source = originals.get(key);
    if (!source) {
      source = (async () => {
        const { data, error } = await documentStore().storage.from(DOCUMENT_BUCKET).download(`${key}.pdf`);
        if (error || !data || data.size > MAX_DOCUMENT_BYTES) throw new Error("Original unavailable");
        return PDFDocument.load(await data.arrayBuffer(), { updateMetadata: false });
      })();
      originals.set(key, source);
      while (originals.size > 2) originals.delete(originals.keys().next().value!);
      source.catch(() => { if (originals.get(key) === source) originals.delete(key); });
    }
    const bytes = await copyReadingPage(await source, number);
    while (cachedBytes + bytes.length > 96 * 1024 * 1024 && pages.size) {
      const oldest = pages.keys().next().value!; cachedBytes -= pages.get(oldest)!.length; pages.delete(oldest);
    }
    if (bytes.length <= MAX_DOCUMENT_BYTES) { pages.set(pageKey, bytes); cachedBytes += bytes.length; }
    return bytes;
  })();
  pending.set(pageKey, job);
  try { return await job; } finally { pending.delete(pageKey); }
}
