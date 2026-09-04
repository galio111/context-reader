export type ReaderBlockInteractivityListener = (interactive: boolean, urgent: boolean) => void;

export interface ReaderBlockInteractivityStore {
  articleIdentity: string;
  getSnapshot: (blockId: string) => boolean;
  subscribe: (blockId: string, listener: ReaderBlockInteractivityListener) => () => void;
  setInteractive: (blockId: string, interactive: boolean, urgent?: boolean) => void;
  replaceInteractive: (blockIds: string[]) => void;
  reveal: (blockIds: string[]) => void;
  beginContinuousScroll: () => void;
  endContinuousScroll: () => void;
}

export function createReaderBlockInteractivityStore(articleIdentity: string): ReaderBlockInteractivityStore {
  const interactiveIds = new Set<string>();
  const listeners = new Map<string, Set<ReaderBlockInteractivityListener>>();
  let pendingInteractiveIds: Set<string> | null = null;

  const notify = (blockId: string, interactive: boolean, urgent: boolean) => {
    listeners.get(blockId)?.forEach((listener) => listener(interactive, urgent));
  };

  const applyInteractiveSet = (nextInteractiveIds: Set<string>) => {
    const changedIds = new Set([...interactiveIds, ...nextInteractiveIds]);
    for (const blockId of changedIds) {
      const interactive = nextInteractiveIds.has(blockId);
      if (interactive === interactiveIds.has(blockId)) continue;
      if (interactive) interactiveIds.add(blockId);
      else interactiveIds.delete(blockId);
      notify(blockId, interactive, false);
    }
  };

  const setInteractive = (blockId: string, interactive: boolean, urgent = false) => {
    if (pendingInteractiveIds && !urgent) {
      if (interactive) pendingInteractiveIds.add(blockId);
      else pendingInteractiveIds.delete(blockId);
      return;
    }

    const changed = interactive ? !interactiveIds.has(blockId) : interactiveIds.has(blockId);
    if (!changed) return;
    if (interactive) interactiveIds.add(blockId);
    else interactiveIds.delete(blockId);
    if (pendingInteractiveIds) {
      if (interactive) pendingInteractiveIds.add(blockId);
      else pendingInteractiveIds.delete(blockId);
    }
    notify(blockId, interactive, urgent);
  };

  const endContinuousScroll = () => {
    if (!pendingInteractiveIds) return;
    const nextInteractiveIds = pendingInteractiveIds;
    pendingInteractiveIds = null;
    applyInteractiveSet(nextInteractiveIds);
  };

  return {
    articleIdentity,
    getSnapshot: (blockId) => interactiveIds.has(blockId),
    subscribe: (blockId, listener) => {
      const blockListeners = listeners.get(blockId) ?? new Set<ReaderBlockInteractivityListener>();
      blockListeners.add(listener);
      listeners.set(blockId, blockListeners);
      return () => {
        blockListeners.delete(listener);
        if (blockListeners.size === 0) listeners.delete(blockId);
      };
    },
    setInteractive,
    replaceInteractive: (blockIds) => {
      const nextInteractiveIds = new Set(blockIds);
      if (pendingInteractiveIds) {
        pendingInteractiveIds = nextInteractiveIds;
        return;
      }
      applyInteractiveSet(nextInteractiveIds);
    },
    reveal: (blockIds) => blockIds.forEach((blockId) => setInteractive(blockId, true, true)),
    beginContinuousScroll: () => {
      if (!pendingInteractiveIds) pendingInteractiveIds = new Set(interactiveIds);
    },
    endContinuousScroll,
  };
}
