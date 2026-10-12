/** Browser-local lifecycle signal, deliberately independent of storage, sync and UI modules. */
export const ACCOUNT_STORAGE_TRANSITION_EVENT = "context-reader:account-storage-transition";
const depths = new WeakMap<Storage, number>();

export function isAccountStorageTransition(storage: Storage): boolean {
  return (depths.get(storage) ?? 0) > 0;
}

function announce(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ACCOUNT_STORAGE_TRANSITION_EVENT));
}

/** Enter before any async archive/restore wait; call the returned release in finally. */
export function beginAccountStorageTransition(storage: Storage): () => void {
  depths.set(storage, (depths.get(storage) ?? 0) + 1);
  announce();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const depth = (depths.get(storage) ?? 1) - 1;
    if (depth > 0) depths.set(storage, depth);
    else depths.delete(storage);
    announce();
  };
}
