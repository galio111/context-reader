import { AsyncLocalStorage } from "node:async_hooks";
import { readDiscoverySetting, writeDiscoverySetting } from "@/lib/discoveryStore";
import { estimateDeepSeekCostMicrocny, estimateDeepSeekCostMicrousd, type ProviderTokenUsage } from "@/lib/usageCost";

export interface EditorialSpend {
  actualMicrocny: number; actualMicrousd: number; reservedMicrocny: number;
  calls: number; inputTokens: number; outputTokens: number; blocked: boolean;
  stages: Record<string, { calls: number; microcny: number }>;
}
const empty = (): EditorialSpend => ({ actualMicrocny: 0, actualMicrousd: 0, reservedMicrocny: 0, calls: 0, inputTokens: 0, outputTokens: 0, blocked: false, stages: {} });
type Store = { read: (key: string) => Promise<EditorialSpend>; write: (key: string, value: EditorialSpend) => Promise<void> };
const context = new AsyncLocalStorage<{ day: string; limit: number; store?: Store }>();
export const editorialBudgetActive = () => !!context.getStore();
export const withEditorialBudget = <T>(day: string, cny: number, work: () => Promise<T>, store?: Store) => context.run({ day, limit: Math.floor(cny * 1e6), store }, work);
export const getEditorialSpend = (day: string) => context.getStore()?.store?.read(`recommendation_editorial_spend_${day}`) ?? readDiscoverySetting<EditorialSpend>(`recommendation_editorial_spend_${day}`, empty());

/** Reservation is durable before dispatch; caller owns the cross-instance discovery lease.
 * Unknown provider outcomes retain their reservation, including process crashes. */
export async function editorialPaidRequest(stage: string, model: string, prompt: string, outputLimit: number, images: number, request: () => Promise<Response>): Promise<Response> {
  const scope = context.getStore();
  if (!scope) return request();
  const key = `recommendation_editorial_spend_${scope.day}`;
  const save = scope.store?.write || writeDiscoverySetting;
  const spent = await getEditorialSpend(scope.day);
  // UTF-8 bytes bound text tokens. Images are resized to <=1024px before dispatch.
  // Peak rates reserve safely even when a request crosses a pricing window.
  const pro = /pro/.test(model);
  const jev = model === "typesafe-ai/jev";
  const reserve = Math.ceil((Buffer.byteLength(prompt, "utf8") + 8000 + images * 16384) * (jev ? 0.042 * 7.2 : pro ? 9 : 2) + outputLimit * (pro ? 27 : 8));
  if (spent.actualMicrocny + spent.reservedMicrocny + reserve > scope.limit) {
    spent.blocked = true;
    await save(key, spent);
    throw new Error("editorial_daily_cost_limit");
  }
  spent.reservedMicrocny += reserve;
  spent.calls++;
  await save(key, spent);
  const response = await request();
  const payload = await response.clone().json().catch(() => null) as { usage?: ProviderTokenUsage; gatewayCostUsd?: number } | null;
  if (payload?.usage && Number.isFinite(payload.usage.prompt_tokens) && Number.isFinite(payload.usage.completion_tokens)) {
    const usd = jev ? Math.ceil((payload.gatewayCostUsd ?? (payload.usage.prompt_tokens || 0) * 0.042 / 1e6) * 1e6) : estimateDeepSeekCostMicrousd(model, payload.usage);
    const cny = jev ? Math.ceil(usd * 7.2) : estimateDeepSeekCostMicrocny(model, payload.usage);
    spent.actualMicrocny += cny;
    spent.actualMicrousd += usd;
    spent.reservedMicrocny -= reserve;
    spent.inputTokens += payload.usage.prompt_tokens || 0;
    spent.outputTokens += payload.usage.completion_tokens || 0;
    const bucket = spent.stages[stage] ||= { calls: 0, microcny: 0 };
    bucket.calls++; bucket.microcny += cny;
    await save(key, spent);
  }
  return response;
}
