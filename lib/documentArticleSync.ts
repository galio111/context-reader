import { normalizeDocumentSource } from "@/lib/documentSource";
import { cleanDocumentText } from "./documentUnicode";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Also repairs pending imports created by older browser tabs before JSONB. */
export function cleanDocumentArticlePayload(value: unknown): unknown {
  const article = record(value);
  if (!normalizeDocumentSource(record(article?.importedArticle)?.document)) return value;
  function clean(item: unknown): unknown {
    if (typeof item === "string") return cleanDocumentText(item);
    if (Array.isArray(item)) return item.map(clean);
    const object = record(item);
    return object ? Object.fromEntries(Object.entries(object).map(([key, child]) => [key, clean(child)])) : item;
  }
  return clean(value);
}

/** Older tabs may serialize only fields they understand. A read-only document's
 * source, page IDs and text must not disappear during a metadata/progress save. */
export function preserveDocumentArticlePayload(incoming: unknown, stored: unknown): unknown {
  const current = record(stored), imported = record(current?.importedArticle), next = record(incoming);
  if (!next || !normalizeDocumentSource(imported?.document)) return incoming;
  return { ...next, body: current!.body, importedArticle: imported };
}
