import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface EditorialRequestRecord { id:string; article?:string; hash?:string; stage:string; model:string; at:string; durationMs?:number; status:string; httpStatus?:number; usage?:ProviderTokenUsage; microcny?:number; microusd?:number; reservedMicrocny:number }
const articleContext = new AsyncLocalStorage<{article:string;hash:string}>();
export const withEditorialArticle = <T>(article:string,hash:string,work:()=>Promise<T>) => articleContext.run({article,hash},work);
import { readDiscoverySetting, writeDiscoverySetting } from "@/lib/discoveryStore";
import { estimateDeepSeekCostMicrocny, estimateDeepSeekCostMicrousd, type ProviderTokenUsage } from "@/lib/usageCost";

export interface EditorialSpend {
  actualMicrocny: number; actualMicrousd: number; reservedMicrocny: number;
  calls: number; inputTokens: number; outputTokens: number; blocked: boolean;
  stages: Record<string, { calls: number; microcny: number }>;
  providers?: Record<string, { calls: number; settledCalls: number; microcny: number; microusd: number; reservedMicrocny: number; inputTokens: number; outputTokens: number }>;
  requests?: EditorialRequestRecord[];
}
const empty = (): EditorialSpend => ({ actualMicrocny: 0, actualMicrousd: 0, reservedMicrocny: 0, calls: 0, inputTokens: 0, outputTokens: 0, blocked: false, stages: {} });
type Store = { read: (key: string) => Promise<EditorialSpend>; write: (key: string, value: EditorialSpend) => Promise<void> };
const context = new AsyncLocalStorage<{ day: string; limit: number; store?: Store }>();
export const editorialBudgetActive = () => !!context.getStore();
export const editorialBudgetDay = () => context.getStore()?.day;
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
  const provider = jev ? "jev" : /^glm-/i.test(model) ? "zhipu" : "deepseek";
  spent.providers ||= {};
  const providerSpend = spent.providers[provider] ||= { calls: 0, settledCalls: 0, microcny: 0, microusd: 0, reservedMicrocny: 0, inputTokens: 0, outputTokens: 0 };
  providerSpend.calls++;
  providerSpend.reservedMicrocny += reserve;
  const started=Date.now();
  const record:EditorialRequestRecord={id:randomUUID(),...articleContext.getStore(),stage,model,at:new Date().toISOString(),status:"reserved",reservedMicrocny:reserve};
  (spent.requests ||= []).push(record);
  await save(key, spent);
  let response:Response;
  try { response = await request(); }
  catch(error) { record.status="unknown_provider_outcome"; record.durationMs=Date.now()-started; await save(key,spent); throw error; }
  record.durationMs=Date.now()-started; record.httpStatus=response.status; record.status="unknown_usage";
  const payload = await response.clone().json().catch(() => null) as { usage?: ProviderTokenUsage; gatewayCostUsd?: number } | null;
  if (payload?.usage && Number.isFinite(payload.usage.prompt_tokens) && Number.isFinite(payload.usage.completion_tokens)) {
    const usd = jev ? Math.ceil((payload.gatewayCostUsd ?? (payload.usage.prompt_tokens || 0) * 0.042 / 1e6) * 1e6) : estimateDeepSeekCostMicrousd(model, payload.usage);
    const cny = jev ? Math.ceil(usd * 7.2) : estimateDeepSeekCostMicrocny(model, payload.usage);
    Object.assign(record,{status:response.ok?"usage_settled":"provider_failed_billed",usage:payload.usage,microcny:cny,microusd:usd,reservedMicrocny:0});
    spent.actualMicrocny += cny;
    spent.actualMicrousd += usd;
    spent.reservedMicrocny -= reserve;
    spent.inputTokens += payload.usage.prompt_tokens || 0;
    spent.outputTokens += payload.usage.completion_tokens || 0;
    providerSpend.settledCalls++;
    providerSpend.microcny += cny;
    providerSpend.microusd += usd;
    providerSpend.reservedMicrocny -= reserve;
    providerSpend.inputTokens += payload.usage.prompt_tokens || 0;
    providerSpend.outputTokens += payload.usage.completion_tokens || 0;
    const bucket = spent.stages[stage] ||= { calls: 0, microcny: 0 };
    bucket.calls++; bucket.microcny += cny;
  }
  await save(key, spent);
  return response;
}

/** Parsing failure never erases the usage settled before parsing. Serial discovery lease owns writes. */
export async function markEditorialOutcome(hash:string,status:string) {
  const scope=context.getStore(); if(!scope) return;
  const spent=await getEditorialSpend(scope.day);
  const record=spent.requests?.findLast(r=>r.hash===hash);
  if(record && record.status==="usage_settled") { record.status=status; await (scope.store?.write||writeDiscoverySetting)(`recommendation_editorial_spend_${scope.day}`,spent); }
}
