import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { PronunciationAccent } from "@/lib/pronunciation";
import { normalizePronunciationText } from "@/lib/pronunciation";

const PRONUNCIATION_BUCKET = "context-reader-pronunciation";
const PROVIDER_ID = "volcengine-v1";
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const DEFAULT_ENDPOINT = "https://openspeech.bytedance.com/api/v1/tts";
const DEFAULT_CLUSTER = "volcano_tts";
const DEFAULT_US_VOICE = "en_female_amanda_mars_bigtts";
const DEFAULT_UK_VOICE = "en_female_emily_mars_bigtts";

interface VolcengineTtsResponse {
  code?: number;
  message?: string;
  data?: string;
}

interface PronunciationCacheClient {
  storage: ReturnType<typeof createClient>["storage"];
}

interface PronunciationResult {
  bytes: Uint8Array;
  filename: string;
  cacheStatus: "hit" | "miss" | "unavailable";
  voice: string;
}

const inFlight = new Map<string, Promise<PronunciationResult>>();

export class MissingPronunciationConfigurationError extends Error {
  constructor() {
    super("Volcengine TTS is not configured.");
    this.name = "MissingPronunciationConfigurationError";
  }
}

export class PronunciationProviderError extends Error {
  status: number;
  providerCode: number;

  constructor(message: string, status = 502, providerCode = 0) {
    super(message);
    this.name = "PronunciationProviderError";
    this.status = status;
    this.providerCode = providerCode;
  }
}

function configuredVoice(accent: PronunciationAccent): string {
  return accent === "en-US"
    ? process.env.VOLCENGINE_TTS_US_VOICE?.trim() || DEFAULT_US_VOICE
    : process.env.VOLCENGINE_TTS_UK_VOICE?.trim() || DEFAULT_UK_VOICE;
}

function pronunciationCacheClient(): PronunciationCacheClient | null {
  const url = process.env.SUPABASE_URL?.trim() || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ensurePronunciationBucket(client: PronunciationCacheClient): Promise<void> {
  const { data } = await client.storage.getBucket(PRONUNCIATION_BUCKET);
  if (data) return;
  const { error } = await client.storage.createBucket(PRONUNCIATION_BUCKET, {
    public: false,
    fileSizeLimit: MAX_AUDIO_BYTES,
    allowedMimeTypes: ["audio/mpeg"],
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

function cacheIdentity(text: string, accent: PronunciationAccent, voice: string): string {
  return createHash("sha256")
    .update([PROVIDER_ID, accent, voice, text].join("\n"))
    .digest("hex");
}

function cachePath(accent: PronunciationAccent, identity: string): string {
  return `${accent === "en-US" ? "us" : "uk"}/${identity}.mp3`;
}

function mediaFilename(accent: PronunciationAccent, identity: string): string {
  return `cr-${accent === "en-US" ? "us" : "uk"}-${identity.slice(0, 24)}.mp3`;
}

async function readCachedAudio(
  client: PronunciationCacheClient,
  path: string,
): Promise<Uint8Array | null> {
  const { data, error } = await client.storage.from(PRONUNCIATION_BUCKET).download(path);
  if (error) {
    if (/not found|does not exist|404/i.test(error.message)) return null;
    throw error;
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  return bytes.byteLength > 0 ? bytes : null;
}

async function writeCachedAudio(
  client: PronunciationCacheClient,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const { error } = await client.storage.from(PRONUNCIATION_BUCKET).upload(
    path,
    Buffer.from(bytes),
    {
      contentType: "audio/mpeg",
      cacheControl: "31536000",
      upsert: false,
    },
  );
  if (error && !/already exists|duplicate/i.test(error.message)) throw error;
}

async function requestVolcengineAudio(
  text: string,
  accent: PronunciationAccent,
  voice: string,
): Promise<Uint8Array> {
  const appId = process.env.VOLCENGINE_TTS_APP_ID?.trim() || "";
  const accessToken = process.env.VOLCENGINE_TTS_ACCESS_TOKEN?.trim() || "";
  if (!appId || !accessToken) {
    throw new MissingPronunciationConfigurationError();
  }

  const response = await fetch(
    process.env.VOLCENGINE_TTS_ENDPOINT?.trim() || DEFAULT_ENDPOINT,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer;${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app: {
          appid: appId,
          token: accessToken,
          cluster: process.env.VOLCENGINE_TTS_CLUSTER?.trim() || DEFAULT_CLUSTER,
        },
        user: {
          uid: `context-reader-${createHash("sha256").update(text).digest("hex").slice(0, 16)}`,
        },
        audio: {
          voice_type: voice,
          encoding: "mp3",
          speed_ratio: 0.9,
          explicit_language: "en",
        },
        request: {
          reqid: randomUUID(),
          text,
          text_type: "plain",
          operation: "query",
        },
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    },
  );

  const raw = await response.text();
  let payload: VolcengineTtsResponse | null = null;
  try {
    payload = JSON.parse(raw) as VolcengineTtsResponse;
  } catch {
    // The legacy HTTP API returns JSON with base64 audio. A non-JSON response
    // is always an upstream failure, even when the HTTP status is 200.
  }
  if (!response.ok || !payload?.data) {
    throw new PronunciationProviderError(
      payload?.message || `Volcengine TTS HTTP ${response.status}`,
      response.ok ? 502 : response.status,
      Number(payload?.code || 0),
    );
  }

  const bytes = new Uint8Array(Buffer.from(payload.data, "base64"));
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AUDIO_BYTES) {
    throw new PronunciationProviderError(
      bytes.byteLength === 0
        ? "Volcengine TTS returned empty audio."
        : "Volcengine TTS audio exceeded the size limit.",
    );
  }
  return bytes;
}

async function createPronunciation(
  text: string,
  accent: PronunciationAccent,
): Promise<PronunciationResult> {
  const normalizedText = normalizePronunciationText(text);
  const voice = configuredVoice(accent);
  const identity = cacheIdentity(normalizedText.toLowerCase(), accent, voice);
  const path = cachePath(accent, identity);
  const filename = mediaFilename(accent, identity);
  const client = pronunciationCacheClient();

  if (client) {
    try {
      await ensurePronunciationBucket(client);
      const cached = await readCachedAudio(client, path);
      if (cached) {
        return { bytes: cached, filename, cacheStatus: "hit", voice };
      }
    } catch (error) {
      console.error("Pronunciation cache read failed", error);
    }
  }

  const bytes = await requestVolcengineAudio(normalizedText, accent, voice);
  if (client) {
    try {
      await ensurePronunciationBucket(client);
      await writeCachedAudio(client, path, bytes);
      return { bytes, filename, cacheStatus: "miss", voice };
    } catch (error) {
      console.error("Pronunciation cache write failed", error);
    }
  }
  return { bytes, filename, cacheStatus: "unavailable", voice };
}

export function getPronunciationAudio(
  text: string,
  accent: PronunciationAccent,
): Promise<PronunciationResult> {
  const voice = configuredVoice(accent);
  const normalizedText = normalizePronunciationText(text);
  const key = cacheIdentity(normalizedText.toLowerCase(), accent, voice);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = createPronunciation(normalizedText, accent).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}
