import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import sharp from "sharp";
import { DOCUMENT_BUCKET, documentStore } from "./documentStore";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENT_PAGES } from "./documentSource";

// Derived reading pages are disposable. The authenticated original is never
// modified; downloads, forms and unsupported catalog features use that original.
const originals = new Map<string, Promise<PDFDocument>>();
const pages = new Map<string, Uint8Array>();
const pending = new Map<string, Promise<Uint8Array>>();
let cachedBytes = 0;
export async function copyReadingPage(source: PDFDocument, number: number, preview = false): Promise<Uint8Array> {
  if (source.catalog.has(PDFName.of("AcroForm")) || source.catalog.has(PDFName.of("OCProperties"))
    || source.catalog.has(PDFName.of("OutputIntents"))) throw new Error("Original document required");
  if (!Number.isInteger(number) || number < 1 || number > source.getPageCount() || source.getPageCount() > MAX_DOCUMENT_PAGES) throw new Error("Invalid page");
  const target = await PDFDocument.create();
  const [page] = await target.copyPages(source, [number - 1]);
  target.addPage(page);
  if (preview) {
    // Only the disposable initial reading copy uses reduced image detail.
    // Text, fonts, page geometry and annotation appearances stay in the PDF;
    // the untouched page replaces this frame after previews are ready.
    for (const [ref, object] of target.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFRawStream) || object.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")
        || object.dict.get(PDFName.of("Filter")) !== PDFName.of("DCTDecode")
        || object.dict.has(PDFName.of("SMask")) || object.dict.has(PDFName.of("Mask")) || object.dict.has(PDFName.of("Decode")) || object.contents.length < 256 * 1024) continue;
      const color = object.dict.lookup(PDFName.of("ColorSpace"));
      const profile = color instanceof PDFArray && color.get(0) === PDFName.of("ICCBased") ? color.lookup(1) : null;
      const rgb = color === PDFName.of("DeviceRGB") || (profile instanceof PDFRawStream && profile.dict.get(PDFName.of("N"))?.toString() === "3");
      if (!rgb) continue;
      try {
        const result = await sharp(object.contents, { limitInputPixels: 100_000_000 }).keepIccProfile()
          .resize({ width: 1400, height: 1800, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 88, chromaSubsampling: "4:4:4" }).toBuffer({ resolveWithObject: true });
        if (result.data.length >= object.contents.length) continue;
        const dict = object.dict.clone(target.context);
        dict.set(PDFName.of("Width"), PDFNumber.of(result.info.width));
        dict.set(PDFName.of("Height"), PDFNumber.of(result.info.height));
        dict.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8));
        // Preserve the PDF's RGB ICC profile; treating its samples as generic
        // sRGB can visibly change scientific image contrast in the preview.
        dict.delete(PDFName.of("DecodeParms"));
        target.context.assign(ref, PDFRawStream.of(dict, new Uint8Array(result.data)));
      } catch { /* Keep the exact image if a decoder cannot prepare its preview. */ }
    }
  }
  return target.save();
}
export async function readDocumentPage(owner: string, id: string, number: number, preview = false): Promise<Uint8Array> {
  const key = `${owner}/${id}`, pageKey = `${key}/${number}/${preview ? "preview-v1" : "original"}`;
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
    const bytes = await copyReadingPage(await source, number, preview);
    while (cachedBytes + bytes.length > 96 * 1024 * 1024 && pages.size) {
      const oldest = pages.keys().next().value!; cachedBytes -= pages.get(oldest)!.length; pages.delete(oldest);
    }
    if (bytes.length <= MAX_DOCUMENT_BYTES) { pages.set(pageKey, bytes); cachedBytes += bytes.length; }
    return bytes;
  })();
  pending.set(pageKey, job);
  try { return await job; } finally { pending.delete(pageKey); }
}
