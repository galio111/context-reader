const PREFIX = "explanation-sha256:";

/** Keep full local lookup identity outside the bounded database index key. */
export async function explanationSyncIdentity(cacheKey: string, explanation: unknown) {
  if (cacheKey.length <= 500) return { objectKey: cacheKey, payload: explanation };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cacheKey));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    objectKey: PREFIX + hash,
    payload: { explanationSyncVersion: 1, cacheKey, explanation },
  };
}

export function explanationFromSync(objectKey: string, payload: unknown) {
  const item = payload as { explanationSyncVersion?: unknown; cacheKey?: unknown; explanation?: unknown } | null;
  if (objectKey.startsWith(PREFIX) && item?.explanationSyncVersion === 1 && typeof item.cacheKey === "string") {
    return { cacheKey: item.cacheKey, explanation: item.explanation };
  }
  return { cacheKey: objectKey, explanation: payload };
}
