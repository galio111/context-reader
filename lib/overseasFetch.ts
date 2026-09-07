import { assertSafeRemoteUrl, safeRemoteFetch, UnsafeRemoteUrlError } from "@/lib/safeRemoteFetch";

export type RemoteDocumentMode = "html" | "feed";

export interface RemoteDocumentFetchResult {
  response: Response;
  finalUrl: string;
  route: "mainland-direct" | "vercel-overseas";
}

const FALLBACK_STATUSES = new Set([403, 408, 425, 429, 451, 500, 502, 503, 504]);
const ALLOWED_FETCHER_HOSTS = new Set([
  "context-reader-overseas-fetch.vercel.app",
  "fetch.context-reader.com",
]);

function overseasFetcherConfig(): { endpoint: URL; token: string } | null {
  const rawEndpoint = process.env.OVERSEAS_FETCH_URL?.trim() ?? "";
  const token = process.env.OVERSEAS_FETCH_TOKEN?.trim() ?? "";
  if (!rawEndpoint || token.length < 32) return null;
  try {
    const endpoint = new URL(rawEndpoint);
    if (endpoint.protocol !== "https:" || !ALLOWED_FETCHER_HOSTS.has(endpoint.hostname) || endpoint.pathname !== "/api/fetch") {
      return null;
    }
    return { endpoint, token };
  } catch {
    return null;
  }
}

function combinedSignal(external: AbortSignal | null | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

async function fetchThroughVercel(
  input: URL,
  mode: RemoteDocumentMode,
  externalSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): Promise<RemoteDocumentFetchResult> {
  const config = overseasFetcherConfig();
  if (!config) throw new Error("Overseas fetcher is not configured.");
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Context-Reader-Fetch-Token": config.token,
    },
    body: JSON.stringify({ url: input.toString(), mode }),
    cache: "no-store",
    signal: combinedSignal(externalSignal, timeoutMs),
  });
  if (response.headers.get("x-context-reader-overseas-fetch") !== "1") {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Overseas fetcher returned an invalid response.");
  }
  const finalUrl = response.headers.get("x-context-reader-final-url") || input.toString();
  await assertSafeRemoteUrl(finalUrl);
  return { response, finalUrl, route: "vercel-overseas" };
}

export async function fetchRemoteDocument(
  input: URL | string,
  init: Omit<RequestInit, "method" | "signal"> = {},
  options: {
    mode?: RemoteDocumentMode;
    directTimeoutMs?: number;
    overseasTimeoutMs?: number;
    signal?: AbortSignal | null;
  } = {},
): Promise<RemoteDocumentFetchResult> {
  const url = await assertSafeRemoteUrl(input);
  const mode = options.mode ?? "html";
  const directTimeoutMs = options.directTimeoutMs ?? 5_000;
  const overseasTimeoutMs = options.overseasTimeoutMs ?? 20_000;
  let directError: unknown;
  try {
    const response = await safeRemoteFetch(url, {
      ...init,
      signal: combinedSignal(options.signal, directTimeoutMs),
    });
    if (!FALLBACK_STATUSES.has(response.status) || !overseasFetcherConfig()) {
      return { response, finalUrl: url.toString(), route: "mainland-direct" };
    }
    await response.body?.cancel().catch(() => undefined);
  } catch (error) {
    if (error instanceof UnsafeRemoteUrlError || options.signal?.aborted) throw error;
    directError = error;
    if (!overseasFetcherConfig()) throw error;
  }

  try {
    return await fetchThroughVercel(url, mode, options.signal, overseasTimeoutMs);
  } catch (error) {
    throw directError ?? error;
  }
}

export function overseasFetcherIsConfigured(): boolean {
  return Boolean(overseasFetcherConfig());
}
