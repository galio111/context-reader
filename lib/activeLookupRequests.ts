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

export async function waitForLookupPeersOrCancellation(
  actionId: string,
  ownController: AbortController,
  options: { peerJoinGraceMs?: number; maxWaitMs?: number; pollMs?: number } = {},
): Promise<"cancelled" | "settled"> {
  if (!isLookupActionId(actionId)) return "settled";
  const peerJoinGraceMs = options.peerJoinGraceMs ?? 300;
  const maxWaitMs = options.maxWaitMs ?? 35_000;
  const pollMs = options.pollMs ?? 40;
  const startedAt = Date.now();
  let sawPeer = false;

  while (true) {
    const active = registry();
    const now = Date.now();
    pruneCancellations(active, now);
    if (ownController.signal.aborted || (active.cancelledUntil.get(actionId) ?? 0) > now) {
      return "cancelled";
    }

    const controllers = active.active.get(actionId);
    const hasPeer = Boolean(controllers && Array.from(controllers).some((controller) => controller !== ownController));
    if (hasPeer) sawPeer = true;
    if (sawPeer && !hasPeer) return "settled";

    const elapsedMs = now - startedAt;
    if ((!sawPeer && elapsedMs >= peerJoinGraceMs) || elapsedMs >= maxWaitMs) {
      return "settled";
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, maxWaitMs - elapsedMs)));
  }
}
