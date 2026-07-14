export const ACCOUNT_DATA_CHANGED_EVENT = "context-reader:account-data-changed";

export function notifyAccountDataChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ACCOUNT_DATA_CHANGED_EVENT));
  }
}
