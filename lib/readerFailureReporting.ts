"use client";

import { reportClientIssue } from "./clientErrorReporting";

export type ReaderSurface = "article" | "cet";

const reportedAt = new Map<string, number>();
const REPORT_INTERVAL_MS = 60_000;
const MAX_REPORT_KEYS = 32;

export function isReaderChunkError(error: unknown): boolean {
  return error instanceof Error && (/^(?:ChunkLoadError|CSSChunkLoadError)$/.test(error.name)
    || /loading (?:css )?chunk .+failed|failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i.test(error.message));
}

function staticLocations(value: string): string[] {
  // Do not send error messages or arbitrary stack frames: either can contain a
  // pasted article, external URL, token, or a component's serialized props.
  return [...new Set(value.match(/\/_next\/static\/[A-Za-z0-9_./%()[\]-]+\.(?:js|css)(?::\d+){0,2}/g) ?? [])].slice(0, 12);
}

export async function reportReaderFailure(error: unknown, componentStack: string | null | undefined, surface: ReaderSurface, attempt: number): Promise<void> {
  if (typeof window === "undefined" || navigator.onLine === false) return;
  const chunk = isReaderChunkError(error);
  const errorName = error instanceof Error && /^(?:Error|TypeError|RangeError|ReferenceError|SyntaxError|ChunkLoadError|CSSChunkLoadError)$/.test(error.name)
    ? error.name : "Error";
  const locations = staticLocations([
    error instanceof Error ? error.stack ?? "" : "",
    chunk && error instanceof Error ? error.message : "",
    componentStack ?? "",
  ].join("\n"));
  const code = chunk ? "READER_CHUNK_LOAD_FAILED" : "READER_RENDER_FAILED";
  const key = [surface, code, errorName, ...locations].join("|");
  const now = Date.now();
  const lastReport = reportedAt.get(key);
  if (lastReport !== undefined && now - lastReport < REPORT_INTERVAL_MS) return;
  reportedAt.delete(key);
  reportedAt.set(key, now);
  if (reportedAt.size > MAX_REPORT_KEYS) reportedAt.delete(reportedAt.keys().next().value!);
  await reportClientIssue({
    category: "client",
    operation: chunk ? "reader_surface_load" : "reader_surface_render",
    page: window.location.origin + window.location.pathname,
    code,
    userMessage: surface === "cet" ? "真题暂时无法打开" : "文章暂时无法打开",
    technicalMessage: `${errorName}: ${chunk ? "reader bundle loading failed" : "reader component failed"}`,
    stack: locations.join("\n"),
    metadata: { surface, attempt, errorName, bundle: locations[0] ?? "" },
  });
}
