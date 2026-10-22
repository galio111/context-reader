import { normalizeDocumentSource } from "@/lib/documentSource";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Older tabs may serialize only fields they understand. A read-only document's
 * source, page IDs and text must not disappear during a metadata/progress save. */
export function preserveDocumentArticlePayload(incoming: unknown, stored: unknown): unknown {
  const current = record(stored), imported = record(current?.importedArticle), next = record(incoming);
  if (!next || !normalizeDocumentSource(imported?.document)) return incoming;
  return { ...next, body: current!.body, importedArticle: imported };
}
