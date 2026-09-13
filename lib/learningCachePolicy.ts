import { isLearningStorage } from "./learningStorage";

export async function pruneAcknowledgedExplanations(storage: Storage, acknowledged: (key: string, value: unknown) => boolean | Promise<boolean>, maxEntries = 20_000, maxBytes = 40 * 1024 * 1024): Promise<number> {
  if (!isLearningStorage(storage)) return 0;
  const key = "context-reader:explanations:v5";
  const cache = JSON.parse(storage.getItem(key) || "{}") as Record<string, unknown>;
  const access = JSON.parse(storage.getItem("context-reader:cache-access:v1") || "{}") as Record<string, number>;
  const entries = Object.entries(cache).map(([id, value]) => ({ id, value, bytes: new TextEncoder().encode(JSON.stringify(value)).length + id.length * 2 }));
  let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0), count = entries.length, removed = 0;
  if (bytes <= maxBytes && count <= maxEntries) return 0;
  entries.sort((a, b) => (access[a.id] || 0) - (access[b.id] || 0));
  for (const entry of entries) {
    if (bytes <= maxBytes && count <= maxEntries) break;
    if (!await acknowledged(entry.id, entry.value)) continue;
    delete cache[entry.id]; delete access[entry.id]; bytes -= entry.bytes; count--; removed++;
  }
  if (removed) { storage.setItem(key, JSON.stringify(cache)); storage.setItem("context-reader:cache-access:v1", JSON.stringify(access)); }
  return removed;
}
