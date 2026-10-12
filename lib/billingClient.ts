import type { BillingPlan } from "./billingStore";
type PublicBilling = { plans: BillingPlan[]; paymentReady: boolean };
let cached: PublicBilling | null = null;
let at = 0;
let pending: Promise<PublicBilling> | null = null;
export function cachedPublicBilling() { return cached; }
export function rememberPublicBilling(value: PublicBilling) {
  // Never retain membership, orders or an account identity in this public cache.
  cached = { plans: value.plans, paymentReady: value.paymentReady }; at = Date.now();
}
export function preparePublicBilling(): Promise<PublicBilling> {
  if (cached && Date.now() - at < 300_000) return Promise.resolve(cached);
  return pending ??= fetch("/api/billing", { signal: AbortSignal.timeout(12_000) }).then(async response => {
    const value = await response.json();
    if (!response.ok || !Array.isArray(value.plans)) throw new Error("套餐暂时无法读取。");
    rememberPublicBilling(value); return cached!;
  }).finally(() => { pending = null; });
}
