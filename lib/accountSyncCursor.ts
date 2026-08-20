import "server-only";

import type { SyncChangeCursor } from "@/lib/accountStore";
import type { SyncObjectKind } from "@/types/account";

const CURSOR_KINDS = new Set<SyncObjectKind>([
  "article",
  "vocabulary",
  "explanation",
  "article_translation",
  "translation_block",
  "reading_state",
  "preferences",
]);

export function encodeAccountSyncCursor(cursor: SyncChangeCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeAccountSyncCursor(raw: string): SyncChangeCursor | null {
  if (!raw || raw.length > 2_000 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<SyncChangeCursor>;
    if (
      typeof parsed.updatedAt !== "string"
      || !Number.isFinite(Date.parse(parsed.updatedAt))
      || typeof parsed.kind !== "string"
      || !CURSOR_KINDS.has(parsed.kind as SyncObjectKind)
      || typeof parsed.objectKey !== "string"
      || !parsed.objectKey
      || parsed.objectKey.length > 500
    ) {
      return null;
    }
    return {
      updatedAt: parsed.updatedAt,
      kind: parsed.kind as SyncObjectKind,
      objectKey: parsed.objectKey,
    };
  } catch {
    return null;
  }
}
