"use client";
import { cacheDocument, documentCacheOwner } from "./documentBinaryCache";
import type { ImportedArticle, ImportedArticleBlock } from "@/types/article";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENT_PAGES, MAX_DOCUMENT_TEXT } from "./documentSource";
import { validateDocumentBytes } from "./documentValidation";
import { cleanDocumentText } from "./documentUnicode";
import { pdfPageBlocks, type PdfTextItem } from "./documentText";
import pdfPackage from "pdfjs-dist/package.json";
const pdfVersion = pdfPackage.version;
export const PDF_RUNTIME = `/document-runtime/${pdfVersion}/`;
export async function pdfLibrary() {
  const pdf: typeof import("pdfjs-dist") = await import(/* webpackIgnore: true */ `${PDF_RUNTIME}pdf.min.mjs`);
  pdf.GlobalWorkerOptions.workerSrc = `${PDF_RUNTIME}pdf.worker.min.mjs`;
  return pdf;
}
export const pdfOptions = { isEvalSupported: false, cMapUrl: `${PDF_RUNTIME}cmaps/`, cMapPacked: true,
  standardFontDataUrl: `${PDF_RUNTIME}standard_fonts/`, wasmUrl: `${PDF_RUNTIME}wasm/` };

export async function prepareDocument(file: File, progress: (message: string) => void): Promise<ImportedArticle> {
  const sourceOwner = documentCacheOwner();
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error("文档不能超过 50MB。");
  const format = file.name.split(".").pop()?.toLowerCase();
  if (format !== "pdf" && format !== "docx") throw new Error("支持 PDF 和 .docx；旧版 .doc 请先另存为 .docx。");
  const buffer = await file.arrayBuffer();
  validateDocumentBytes(new Uint8Array(buffer), format);
  let blocks: ImportedArticleBlock[] = [], pageCount = 1;
  if (format === "pdf") {
    const pdfjs = await pdfLibrary();
    const loading = pdfjs.getDocument({ data: buffer, ...pdfOptions });
    loading.onPassword = () => { void loading.destroy(); };
    try {
      const pdf = await loading.promise;
      pageCount = pdf.numPages;
      if (pageCount > MAX_DOCUMENT_PAGES) throw new Error("文档最多支持 500 页，请拆分后导入。");
      for (let i = 1; i <= pageCount; i++) {
        progress(`正在读取第 ${i} / ${pageCount} 页…`);
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        blocks.push(...pdfPageBlocks(content.items.filter(v => "str" in v) as PdfTextItem[], i));
        page.cleanup();
      }
    } catch (error) {
      if (error instanceof Error && /500/.test(error.message)) throw error;
      throw new Error("PDF 无法读取，请确认文件未加密且没有损坏。");
    } finally { await loading.destroy(); }
  } else {
    progress("正在读取 Word 文档…");
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    const dom = new DOMParser().parseFromString(xml, "application/xml");
    blocks = Array.from(dom.getElementsByTagNameNS("*", "p")).flatMap((p, i) => {
      const text = Array.from(p.getElementsByTagNameNS("*", "t")).map(t => t.textContent ?? "").join("").trim();
      return text ? [{ id: `doc-word-b${i}`, type: "paragraph" as const, text }] : [];
    });
  }
  // A Word paragraph can span tens of thousands of characters. Keep every word
  // while ensuring no target is silently truncated by the translation endpoint.
  blocks = blocks.flatMap(block => {
    let remaining = cleanDocumentText(block.text ?? "");
    const parts: ImportedArticleBlock[] = [];
    while (remaining.length > 3500) {
      const space = remaining.lastIndexOf(" ", 3500);
      const end = space > 2000 ? space : 3500;
      parts.push({ ...block, id: `${block.id}-part${parts.length}`, text: remaining.slice(0, end) });
      remaining = remaining.slice(end).trimStart();
    }
    return parts.length ? [...parts, { ...block, id: `${block.id}-part${parts.length}`, text: remaining }] : [{ ...block, text: remaining }];
  });
  const text = blocks.map(b => b.text).join("\n\n");
  if (text.trim().length < 30) throw new Error("文档没有足够的可读取文字，暂不支持扫描件或纯图片文档。");
  if (text.length > MAX_DOCUMENT_TEXT) throw new Error("文档文字过多，请拆分后导入。");
  progress("正在保存文档…");
  const form = new FormData(); form.set("file", file);
  const response = await fetch("/api/documents", { method: "POST", body: form, signal: AbortSignal.timeout(180_000) });
  const result = await response.json();
  if (!response.ok || !result.document) throw new Error(result.error || "文档未能保存，请稍后重试。");
  await cacheDocument(sourceOwner, result.document.id, await file.arrayBuffer());
  return { title: file.name.replace(/\.(pdf|docx)$/i, ""), url: "", siteName: format === "pdf" ? "PDF 文档" : "Word 文档",
    text, blocks, document: { ...result.document, pageCount } };
}
