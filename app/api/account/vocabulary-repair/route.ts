import { NextResponse } from "next/server";
import { listSyncObjects, writeSyncObjects } from "@/lib/accountStore";
import { normalizeVocabularyEntries } from "@/lib/vocabulary";
import { deduplicateVocabularyEntries, vocabularyIdentity } from "@/lib/vocabularyMerge";
import { getAuthenticatedUser } from "@/lib/userAuth";
import type { AccountSyncObject } from "@/types/account";
import type { VocabularyEntry } from "@/types/vocabulary";

function activeVocabularyObjects(objects: AccountSyncObject[]): AccountSyncObject[] {
  return objects.filter((object) => object.kind === "vocabulary" && !object.deletedAt);
}

function normalizedEntry(object: AccountSyncObject): VocabularyEntry | null {
  const entry = normalizeVocabularyEntries([object.payload])[0];
  return entry ? { ...entry, id: object.objectKey } : null;
}

async function repairVocabulary(userId: string, retriesRemaining: number): Promise<{
  before: number;
  after: number;
  removed: number;
  recoveredActive: number;
}> {
  const cloud = await listSyncObjects(userId);
  const active = activeVocabularyObjects(cloud);
  const objectById = new Map(active.map((object) => [object.objectKey, object]));
  const groups = new Map<string, VocabularyEntry[]>();
  for (const object of active) {
    const entry = normalizedEntry(object);
    if (!entry) continue;
    const identity = vocabularyIdentity(entry);
    const group = groups.get(identity);
    if (group) group.push(entry);
    else groups.set(identity, [entry]);
  }

  const now = new Date().toISOString();
  const writes: AccountSyncObject[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const deduplicated = deduplicateVocabularyEntries(group);
    const canonical = deduplicated.entries[0];
    const canonicalCloud = objectById.get(canonical.id);
    if (canonicalCloud) {
      writes.push({
        kind: "vocabulary",
        objectKey: canonical.id,
        payload: canonical,
        clientUpdatedAt: canonical.updatedAt || now,
        serverVersion: canonicalCloud.serverVersion,
      });
    }
    for (const removedId of deduplicated.removedIds) {
      const duplicate = objectById.get(removedId);
      if (!duplicate) continue;
      writes.push({
        kind: "vocabulary",
        objectKey: removedId,
        payload: duplicate.payload,
        clientUpdatedAt: now,
        serverVersion: duplicate.serverVersion,
        deletedAt: now,
      });
    }
  }

  if (writes.length > 0) {
    const results = await writeSyncObjects(userId, writes);
    if (results.some((result) => !result.accepted) && retriesRemaining > 0) {
      return repairVocabulary(userId, retriesRemaining - 1);
    }
  }

  const finalCloud = activeVocabularyObjects(await listSyncObjects(userId));
  const finalEntries = finalCloud
    .map(normalizedEntry)
    .filter((entry): entry is VocabularyEntry => Boolean(entry));
  const finalUnique = new Set(finalEntries.map(vocabularyIdentity));
  return {
    before: active.length,
    after: finalUnique.size,
    removed: Math.max(0, active.length - finalCloud.length),
    recoveredActive: finalCloud.filter((object) => object.objectKey.includes("-local-recovered-")).length,
  };
}

export async function POST() {
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "请先登录。", code: "login_required" }, { status: 401 });
  }
  const result = await repairVocabulary(user.id, 5);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
