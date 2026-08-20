export const ACCOUNT_DATA_CHANGED_EVENT = "context-reader:account-data-changed";
export const ACCOUNT_DATA_MERGED_EVENT = "context-reader:account-data-merged";
export const ACCOUNT_SYNC_TOMBSTONES_KEY = "context-reader:sync-tombstones:v1";

export type AccountDeletedObjectKind = "article" | "vocabulary" | "preferences";

export function notifyAccountDataChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ACCOUNT_DATA_CHANGED_EVENT));
  }
}

export function notifyAccountDataMerged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ACCOUNT_DATA_MERGED_EVENT));
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
  notifyAccountDataChanged();
}
