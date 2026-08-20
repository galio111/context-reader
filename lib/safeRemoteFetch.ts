import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
]);

export class UnsafeRemoteUrlError extends Error {
  constructor(message = "该地址不允许访问。") {
    super(message);
    this.name = "UnsafeRemoteUrlError";
  }
}

export class RemoteBodyTooLargeError extends Error {
  constructor() {
    super("远程内容超过允许大小。");
    this.name = "RemoteBodyTooLargeError";
  }
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  const firstHextet = Number.parseInt(normalized.split(":")[0] || "0", 16);
  if (normalized.startsWith("::")) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isIP(mapped) === 4 ? isBlockedIpv4(mapped) : true;
  }
  return (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    firstHextet < 0x2000 ||
    firstHextet > 0x3fff ||
    /^fe[89abcdef]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8") ||
    normalized.startsWith("2001:0:") ||
    normalized.startsWith("2001::") ||
    normalized.startsWith("2001:20:") ||
    normalized.startsWith("2002:") ||
    normalized.startsWith("64:ff9b:")
  );
}

function isBlockedAddress(address: string): boolean {
  const family = isIP(stripIpv6Brackets(address));
  if (family === 4) {
    return isBlockedIpv4(address);
  }
  if (family === 6) {
    return isBlockedIpv6(stripIpv6Brackets(address));
  }
  return true;
}

function keepSafeAddresses<T extends { address: string }>(addresses: T[]): T[] {
  return addresses.filter(({ address }) => !isBlockedAddress(address));
}

export async function assertSafeRemoteUrl(input: URL | string): Promise<URL> {
  const url = input instanceof URL ? new URL(input.toString()) : new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeRemoteUrlError("只允许访问 http 或 https 地址。");
  }
  if (url.username || url.password) {
    throw new UnsafeRemoteUrlError("地址不能包含用户名或密码。");
  }
  if ((url.protocol === "http:" && url.port && url.port !== "80") ||
      (url.protocol === "https:" && url.port && url.port !== "443")) {
    throw new UnsafeRemoteUrlError("不允许访问非标准端口。");
  }

  const hostname = stripIpv6Brackets(url.hostname.toLowerCase().replace(/\.$/, ""));
  if (
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new UnsafeRemoteUrlError();
  }

  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new UnsafeRemoteUrlError();
    }
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UnsafeRemoteUrlError("目标域名无法解析。");
  }
  if (!keepSafeAddresses(addresses).length) {
    throw new UnsafeRemoteUrlError();
  }
  return url;
}

async function resolveSafeAddresses(url: URL): Promise<Array<{ address: string; family: number }>> {
  const hostname = stripIpv6Brackets(url.hostname.toLowerCase().replace(/\.$/, ""));
  if (isIP(hostname)) {
    return [{ address: hostname, family: isIP(hostname) }];
  }
  const addresses = keepSafeAddresses(await lookup(hostname, { all: true, verbatim: true }));
  if (!addresses.length) {
    throw new UnsafeRemoteUrlError();
  }
  return addresses.sort((left, right) => left.family - right.family);
}

function fetchPinnedAddress(
  url: URL,
  address: { address: string; family: number },
  init: RequestInit,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    headers.host = url.host;
    headers["accept-encoding"] = "identity";
    const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;
    const nodeRequest = requestImpl(
      {
        hostname: address.address,
        family: address.family,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers,
        signal: init.signal ?? undefined,
        ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
      },
      (incoming) => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) {
            value.forEach((item) => responseHeaders.append(key, item));
          } else if (value !== undefined) {
            responseHeaders.set(key, value);
          }
        }
        resolve(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
          status: incoming.statusCode ?? 502,
          statusText: incoming.statusMessage,
          headers: responseHeaders,
        }));
      },
    );
    nodeRequest.on("error", reject);
    nodeRequest.end();
  });
}

export async function safeRemoteFetch(
  input: URL | string,
  init: RequestInit = {},
  options: { maxRedirects?: number } = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 3;
  let current = await assertSafeRemoteUrl(input);

  if (init.method && init.method !== "GET") {
    throw new UnsafeRemoteUrlError("安全远程读取只允许 GET 请求。");
  }

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const addresses = await resolveSafeAddresses(current);
    let response: Response | null = null;
    let lastError: unknown;
    for (const address of addresses) {
      try {
        response = await fetchPinnedAddress(current, address, init);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!response) {
      throw lastError instanceof Error ? lastError : new Error("Remote request failed.");
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location || redirectCount === maxRedirects) {
      throw new UnsafeRemoteUrlError("目标地址重定向次数过多。");
    }
    current = await assertSafeRemoteUrl(new URL(location, current));
  }

  throw new UnsafeRemoteUrlError("目标地址重定向次数过多。");
}

export async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new RemoteBodyTooLargeError();
  }
  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RemoteBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readResponseBytes(response, maxBytes));
}
