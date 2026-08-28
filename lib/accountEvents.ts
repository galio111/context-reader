import type { SyncObjectKind } from "@/types/account";

export const ACCOUNT_DATA_CHANGED_EVENT = "context-reader:account-data-changed";
export const ACCOUNT_DATA_MERGED_EVENT = "context-reader:account-data-merged";
export const ACCOUNT_SYNC_TOMBSTONES_KEY = "context-reader:sync-tombstones:v1";

export type AccountDeletedObjectKind = "article" | "vocabulary" | "reading_state" | "preferences";

export interface AccountDataChangedDetail {
  kinds: SyncObjectKind[];
}

export function accountDataEventKinds(event: Event): SyncObjectKind[] {
  if (!(event instanceof CustomEvent) || !event.detail || typeof event.detail !== "object") return [];
  const kinds = (event.detail as Partial<AccountDataChangedDetail>).kinds;
  return Array.isArray(kinds) ? kinds : [];
}

export function notifyAccountDataChanged(kinds: SyncObjectKind[] = []): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<AccountDataChangedDetail>(ACCOUNT_DATA_CHANGED_EVENT, {
      detail: { kinds: Array.from(new Set(kinds)) },
    }));
  }
}

export function notifyAccountDataMerged(kinds: SyncObjectKind[] = []): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<AccountDataChangedDetail>(ACCOUNT_DATA_MERGED_EVENT, {
      detail: { kinds: Array.from(new Set(kinds)) },
    }));
  }
}

export function notifyAccountObjectsDeleted(
  kind: AccountDeletedObjectKind,
  objectKeys: string[],
): void {
  if (typeof window === "undefined" || objectKeys.length === 0) {
    return;
  }

  let tombstones: Record<string, string> = {};
  try {
    tombstones = JSON.parse(window.localStorage.getItem(ACCOUNT_SYNC_TOMBSTONES_KEY) || "{}") as Record<string, string>;
  } catch {
    tombstones = {};
  }

  const deletedAt = new Date().toISOString();
  for (const objectKey of objectKeys) {
    if (objectKey) {
      tombstones[`${kind}:${objectKey}`] = deletedAt;
    }
  }
  window.localStorage.setItem(ACCOUNT_SYNC_TOMBSTONES_KEY, JSON.stringify(tombstones));
  notifyAccountDataChanged([kind]);
}
