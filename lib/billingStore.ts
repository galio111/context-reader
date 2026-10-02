import { accountFetch } from "@/lib/accountStore";
import { PLAN_NAMES } from "@/lib/billingPolicy";

export interface BillingPlan { id: string; name: string; monthlyFen: number; annualFen: number; points: number; active: boolean }
export interface BillingOrder {
  id: string; user_id: string; plan_id: string; term: "month" | "year"; kind: "membership" | "topup";
  status: "pending" | "paid" | "closed" | "review" | "refunding" | "refunded";
  price_fen: number; credit_fen: number; amount_fen: number; points: number; created_at: string; expires_at: string;
  paid_at: string | null; fulfilled_at: string | null; transaction_id: string | null; review_reason: string | null;
}
export interface BillingQuote { planId: string; term: string; kind: string; priceFen: number; creditFen: number; amountFen: number; points: number }
export async function billingRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  return accountFetch<T>(`rpc/billing_${name}`, { method: "POST", body: JSON.stringify(args) });
}
export async function billingCatalog(): Promise<BillingPlan[]> {
  const [prices, limits, plans] = await Promise.all([
    accountFetch<Array<{ id: string; monthly_fen: number; annual_fen: number }>>("billing_plans?select=id,monthly_fen,annual_fen"),
    accountFetch<Array<{ plan_id: string; allowance: number }>>("quota_plan_limits?metric_key=eq.learning_points&select=plan_id,allowance"),
    accountFetch<Array<{ id: string; active: boolean }>>("quota_plans?select=id,active"),
  ]);
  return ["free", "basic", "plus", "max"].flatMap(id => {
    const p = prices.find(p => p.id === id); if (!p) return [];
    return [{ id, name: PLAN_NAMES[id], monthlyFen: Number(p.monthly_fen), annualFen: Number(p.annual_fen), points: Number(limits.find(l => l.plan_id === id)?.allowance ?? 0), active: Boolean(plans.find(p => p.id === id)?.active) }];
  });
}
export async function ownedOrder(id: string, userId?: string): Promise<BillingOrder | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await accountFetch<BillingOrder[]>(`billing_orders?id=eq.${id}${userId ? `&user_id=eq.${userId}` : ""}&select=*&limit=1`);
  return rows[0] ?? null;
}
export function publicOrder(o: BillingOrder) {
  return { id: o.id, planId: o.plan_id, term: o.term, kind: o.kind, status: o.status === "pending" && Date.parse(o.expires_at) <= Date.now() ? "closed" : o.status, priceFen: o.price_fen, creditFen: o.credit_fen, amountFen: o.amount_fen, points: o.points, expiresAt: o.expires_at, createdAt: o.created_at, paidAt: o.paid_at };
}
