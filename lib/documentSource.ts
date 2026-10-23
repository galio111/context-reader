import type { ImportedDocumentSource } from "@/types/article";

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
export const MAX_DOCUMENT_PAGES = 500;
export const MAX_DOCUMENT_TEXT = 1_000_000;
export function normalizeDocumentSource(value: unknown): ImportedDocumentSource | undefined {
  const v = value as Partial<ImportedDocumentSource> | undefined;
  if (!v || !/^[a-f0-9]{64}$/.test(v.id ?? "") || (v.format !== "pdf" && v.format !== "docx")) return;
  return { id: v.id!, format: v.format, name: String(v.name ?? "文档").slice(0, 240),
    pageCount: Math.max(1, Math.min(MAX_DOCUMENT_PAGES, Number(v.pageCount) || 1)) };
}
export function documentUrl(source: ImportedDocumentSource): string {
  return `/api/documents/${source.id}?format=${source.format}`;
}
