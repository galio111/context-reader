import { timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_RESPONSE_BYTES = 1_500_000;
const UPSTREAM_TIMEOUT_MS = 12_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "metadata", "metadata.google.internal"]);
const ACCEPT_HEADERS = {
  html: "text/html,application/xhtml+xml",
  feed: "application/rss+xml,application/atom+xml,application/xml,text/xml",
};

function safeSecretEqual(actual, expected) {
  const left = Buffer.from(actual || "");
  const right = Buffer.from(expected || "");
  return left.length === right.length && left.length >= 32 && timingSafeEqual(left, right);
}

function stripIpv6Brackets(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function blockedIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224;
}

function blockedIpv6(address) {
  const normalized = address.toLowerCase().split("%")[0];
  const firstHextet = Number.parseInt(normalized.split(":")[0] || "0", 16);
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isIP(mapped) === 4 ? blockedIpv4(mapped) : true;
  }
  return normalized.startsWith("::") || normalized.startsWith("fc") || normalized.startsWith("fd") ||
    firstHextet < 0x2000 || firstHextet > 0x3fff || /^fe[89abcdef]/.test(normalized) ||
    normalized.startsWith("ff") || normalized.startsWith("2001:db8") || normalized.startsWith("2001:0:") ||
    normalized.startsWith("2001::") || normalized.startsWith("2001:20:") || normalized.startsWith("2002:") ||
    normalized.startsWith("64:ff9b:");
}

function blockedAddress(address) {
  const normalized = stripIpv6Brackets(address);
  const family = isIP(normalized);
  return family === 4 ? blockedIpv4(normalized) : family === 6 ? blockedIpv6(normalized) : true;
}

async function safeUrl(input) {
  const url = input instanceof URL ? new URL(input) : new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("unsafe-url");
  if ((url.protocol === "http:" && url.port && url.port !== "80") ||
      (url.protocol === "https:" && url.port && url.port !== "443")) throw new Error("unsafe-url");
  const hostname = stripIpv6Brackets(url.hostname.toLowerCase().replace(/\.$/, ""));
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new Error("unsafe-url");
  if (isIP(hostname)) {
    if (blockedAddress(hostname)) throw new Error("unsafe-url");
    return url;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.some(({ address }) => !blockedAddress(address))) throw new Error("unsafe-url");
  return url;
}

async function safeAddresses(url) {
  const hostname = stripIpv6Brackets(url.hostname.toLowerCase().replace(/\.$/, ""));
  if (isIP(hostname)) return [{ address: hostname, family: isIP(hostname) }];
  const addresses = (await lookup(hostname, { all: true, verbatim: true }))
    .filter(({ address }) => !blockedAddress(address))
    .sort((left, right) => left.family - right.family);
  if (!addresses.length) throw new Error("unsafe-url");
  return addresses;
}

function requestPinned(url, address, accept, signal) {
  return new Promise((resolve, reject) => {
    const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;
    const upstream = requestImpl({
      hostname: address.address,
      family: address.family,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: {
        host: url.host,
        accept,
        "accept-language": "en-US,en;q=0.9",
        "accept-encoding": "identity",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152 Safari/537.36",
      },
      signal,
      ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
    }, resolve);
    upstream.on("error", reject);
    upstream.end();
  });
}

async function fetchPinned(input, accept, signal) {
  let current = await safeUrl(input);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    let response;
    let lastError;
    for (const address of await safeAddresses(current)) {
      try {
        response = await requestPinned(current, address, accept, signal);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!response) throw lastError || new Error("upstream-failed");
    if (!REDIRECT_STATUSES.has(response.statusCode || 502)) return { response, finalUrl: current };
    const rawLocation = response.headers.location;
    const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
    response.resume();
    if (!location || redirects === 3) throw new Error("too-many-redirects");
    current = await safeUrl(new URL(location, current));
  }
  throw new Error("too-many-redirects");
}

async function readRequestJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) throw new Error("request-too-large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readBounded(response) {
  const declared = Number.parseInt(String(response.headers["content-length"] || ""), 10);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("response-too-large");
  const chunks = [];
  let total = 0;
  for await (const chunk of response) {
    total += chunk.length;
    if (total > MAX_RESPONSE_BYTES) {
      response.destroy();
      throw new Error("response-too-large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function json(response, status, payload) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(payload));
}

export default async function handler(request, response) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  if (request.method !== "POST") return json(response, 405, { error: "method-not-allowed" });
  const configuredToken = process.env.OVERSEAS_FETCH_TOKEN || "";
  if (!safeSecretEqual(request.headers["x-context-reader-fetch-token"], configuredToken)) {
    return json(response, 401, { error: "unauthorized" });
  }

  try {
    const body = await readRequestJson(request);
    const url = typeof body?.url === "string" && body.url.length <= 4096 ? body.url : "";
    const mode = body?.mode === "feed" ? "feed" : "html";
    if (!url) return json(response, 400, { error: "invalid-url" });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const { response: upstream, finalUrl } = await fetchPinned(url, ACCEPT_HEADERS[mode], controller.signal);
      const contents = await readBounded(upstream);
      response.statusCode = upstream.statusCode || 502;
      response.setHeader("content-type", String(upstream.headers["content-type"] || "application/octet-stream"));
      response.setHeader("x-context-reader-final-url", finalUrl.toString());
      response.setHeader("x-context-reader-overseas-fetch", "1");
      response.end(contents);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "fetch-failed";
    const status = code === "unsafe-url" || code === "invalid-url" ? 400 :
      code === "request-too-large" || code === "response-too-large" ? 413 : 502;
    return json(response, status, { error: status === 400 ? "unsafe-url" : "overseas-fetch-failed" });
  }
}
