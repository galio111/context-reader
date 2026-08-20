"use client";

import type { PronunciationAccent } from "@/lib/pronunciation";

export interface PronunciationMedia {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}

export class PronunciationRequestError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = "pronunciation_failed", status = 0) {
    super(message);
    this.name = "PronunciationRequestError";
    this.code = code;
    this.status = status;
  }
}

const mediaRequests = new Map<string, Promise<PronunciationMedia>>();
const MAX_CACHED_MEDIA = 120;

function cacheKey(text: string, accent: PronunciationAccent): string {
  return `${accent}\n${text.trim().toLowerCase()}`;
}

function filenameFromHeader(response: Response, accent: PronunciationAccent): string {
  const explicit = response.headers.get("x-pronunciation-filename")?.trim();
  if (explicit) return explicit;
  return `context-reader-${accent === "en-US" ? "us" : "uk"}-${Date.now()}.mp3`;
}

async function loadPronunciationMedia(
  text: string,
  accent: PronunciationAccent,
): Promise<PronunciationMedia> {
  let response: Response;
  try {
    response = await fetch("/api/pronunciation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, accent }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new PronunciationRequestError(
      "发音服务暂时无法连接。",
      "pronunciation_network",
    );
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as {
      error?: string;
      code?: string;
    } | null;
    throw new PronunciationRequestError(
      payload?.error || "发音服务暂时不可用。",
      payload?.code || "pronunciation_failed",
      response.status,
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new PronunciationRequestError("发音服务返回了空音频。", "pronunciation_empty");
  }
  return {
    bytes: new Uint8Array(buffer),
    contentType: response.headers.get("content-type") || "audio/mpeg",
    filename: filenameFromHeader(response, accent),
  };
}

export function requestPronunciationMedia(
  text: string,
  accent: PronunciationAccent,
): Promise<PronunciationMedia> {
  const key = cacheKey(text, accent);
  const existing = mediaRequests.get(key);
  if (existing) return existing;

  const request = loadPronunciationMedia(text, accent).catch((error) => {
    mediaRequests.delete(key);
    throw error;
  });
  mediaRequests.set(key, request);
  if (mediaRequests.size > MAX_CACHED_MEDIA) {
    const oldestKey = mediaRequests.keys().next().value as string | undefined;
    if (oldestKey) mediaRequests.delete(oldestKey);
  }
  return request;
}

export async function requestPronunciationPair(text: string): Promise<{
  us: PronunciationMedia;
  uk: PronunciationMedia;
}> {
  const [us, uk] = await Promise.all([
    requestPronunciationMedia(text, "en-US"),
    requestPronunciationMedia(text, "en-GB"),
  ]);
  return { us, uk };
}
