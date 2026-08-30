const ACTIVE_LOOKUP_REGISTRY = Symbol.for("context-reader.active-lookup-requests.v2");
const CANCELLATION_TTL_MS = 60_000;
const MAX_PENDING_CANCELLATIONS = 2_000;

interface LookupRegistry {
  active: Map<string, Set<AbortController>>;
  cancelledUntil: Map<string, number>;
}

function registry(): LookupRegistry {
  const processGlobal = globalThis as typeof globalThis & {
    [ACTIVE_LOOKUP_REGISTRY]?: LookupRegistry;
  };
  processGlobal[ACTIVE_LOOKUP_REGISTRY] ??= {
    active: new Map(),
    cancelledUntil: new Map(),
  };
  return processGlobal[ACTIVE_LOOKUP_REGISTRY];
}

function pruneCancellations(active: LookupRegistry, now = Date.now()): void {
  for (const [actionId, expiresAt] of active.cancelledUntil) {
    if (expiresAt > now) continue;
    active.cancelledUntil.delete(actionId);
  }
  while (active.cancelledUntil.size >= MAX_PENDING_CANCELLATIONS) {
    const oldest = active.cancelledUntil.keys().next().value as string | undefined;
    if (!oldest) break;
    active.cancelledUntil.delete(oldest);
  }
}

export function isLookupActionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function registerActiveLookupRequest(actionId: string, controller: AbortController): () => void {
  if (!isLookupActionId(actionId)) return () => undefined;
  const active = registry();
  const now = Date.now();
  pruneCancellations(active, now);
  if ((active.cancelledUntil.get(actionId) ?? 0) > now) {
    controller.abort();
    return () => undefined;
  }
  const controllers = active.active.get(actionId) ?? new Set<AbortController>();
  controllers.add(controller);
  active.active.set(actionId, controllers);

  return () => {
    controllers.delete(controller);
    if (controllers.size === 0) active.active.delete(actionId);
  };
}

export function cancelActiveLookupRequests(actionId: string): number {
  if (!isLookupActionId(actionId)) return 0;
  const active = registry();
  pruneCancellations(active);
  active.cancelledUntil.delete(actionId);
  active.cancelledUntil.set(actionId, Date.now() + CANCELLATION_TTL_MS);
  const controllers = active.active.get(actionId);
  if (!controllers?.size) return 0;
  active.active.delete(actionId);
  for (const controller of controllers) controller.abort();
  return controllers.size;
}
