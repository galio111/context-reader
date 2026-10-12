import { pronunciationTargetMatches } from "@/lib/pronunciation";
import { IncrementalJsonObjectParser } from "@/lib/incrementalJsonObjects";

const CHINESE_QUERY_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/u;
const PROVIDER_EVENT_TYPES = new Set(["head", "sense", "verbForms", "usage", "collocation", "wordFamily", "synonym", "mistake", "memory", "done"]);

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Enforce pronunciation ownership before an upstream dictionary line reaches
 * the browser. The client repeats the same validation, so a provider response
 * cannot regain an ambiguous lemma-owned IPA through a future UI refactor.
 */
export function normalizeDictionaryStreamLine(line: string, query: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "";

  const candidate = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return "";

  try {
    const event = JSON.parse(candidate) as Record<string, unknown>;
    // This event is issued only by our server after account-scoped persistence.
    if (typeof event.type !== "string" || !PROVIDER_EVENT_TYPES.has(event.type)) return "";
    if (event.type !== "head") return JSON.stringify(event);

    event.query = query;
    if (CHINESE_QUERY_PATTERN.test(query)) {
      return JSON.stringify(event);
    }

    const phonetic = clean(event.phonetic);
    const phoneticFor = clean(event.phoneticFor);
    if (!phonetic || !pronunciationTargetMatches(phoneticFor, query)) {
      event.phonetic = "";
      event.phoneticFor = "";
    } else {
      event.phonetic = phonetic;
      event.phoneticFor = query;
    }
    return JSON.stringify(event);
  } catch {
    return "";
  }
}

export class DictionaryProviderStreamNormalizer {
  private readonly parser = new IncrementalJsonObjectParser();

  constructor(private readonly query: string) {}

  push(chunk: string): string[] {
    const normalized: string[] = [];
    for (const value of this.parser.push(chunk)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const line = normalizeDictionaryStreamLine(JSON.stringify(value), this.query);
      if (line) normalized.push(line);
    }
    return normalized;
  }
}
