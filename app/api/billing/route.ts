import { NextResponse } from "next/server";
import { accountFetch } from "@/lib/accountStore";
import { billingCatalog, billingRpc, ownedOrder, publicOrder, type BillingOrder } from "@/lib/billingStore";
import { createWechatCheckout, queryWechatOrder, wechatReady } from "@/lib/wechatPay";
import { resolveUsageIdentity } from "@/lib/usageIdentity";
import { requestExternalOrigin } from "@/lib/requestSecurity";
import { readJsonBody } from "@/lib/limitedBody";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
 try {
  const plans = await billingCatalog();
  if (!new URL(request.url).searchParams.has("account")) return NextResponse.json({ plans: plans.filter(p => p.active), paymentReady: wechatReady() });
  const identity = await resolveUsageIdentity(request);
  if (!identity.authenticated || identity.suspended || !identity.userId || identity.localOnly) return NextResponse.json({ error: "请登录后查看订单。" }, { status: 401 });
  const [memberships, orders] = await Promise.all([
   accountFetch<unknown[]>(`billing_memberships?user_id=eq.${identity.userId}&select=plan_id,term,starts_at,ends_at&limit=1`),
   accountFetch<BillingOrder[]>(`billing_orders?user_id=eq.${identity.userId}&select=*&order=created_at.desc&limit=30`),
  ]);
  return NextResponse.json({ plans: plans.filter(p => p.active), paymentReady: wechatReady(), membership: memberships[0] ?? null, orders: orders.map(publicOrder) });
 } catch { return NextResponse.json({ error: "套餐信息暂时无法读取，请稍后重试。" }, { status: 503 }); }
}
export async function POST(request: Request) {
 if (request.headers.get("origin") !== requestExternalOrigin(request)) return NextResponse.json({ error: "请从本站操作。" }, { status: 403 });
 try {
  const identity = await resolveUsageIdentity(request);
  if (!identity.authenticated || !identity.userId || identity.localOnly || identity.suspended) return NextResponse.json({ error: "请使用有效账号登录后购买。" }, { status: 401 });
  const body = await readJsonBody<Record<string, unknown>>(request, 8192);
  if (body.action === "check") {
   let order = typeof body.orderId === "string" ? await ownedOrder(body.orderId, identity.userId) : null;
   if (!order) return NextResponse.json({ error: "订单不存在。" }, { status: 404 });
   if (order.status === "pending" && wechatReady()) { await queryWechatOrder(order); order = (await ownedOrder(order.id, identity.userId))!; }
   return NextResponse.json({ order: publicOrder(order) });
  }
  if (!["basic","plus","max"].includes(String(body.planId)) || !["month","year"].includes(String(body.term)) || !["membership","topup"].includes(String(body.kind))) return NextResponse.json({ error: "请选择有效套餐。" }, { status: 400 });
  const args = { p_user: identity.userId, p_plan: body.planId, p_term: body.term, p_kind: body.kind };
  if (body.action === "quote") return NextResponse.json({ quote: await billingRpc("quote", args) });
  if (body.action !== "create" || !Number.isSafeInteger(body.amountFen)) return NextResponse.json({ error: "订单参数无效。" }, { status: 400 });
  if (!wechatReady()) return NextResponse.json({ error: "微信支付尚未开放，暂时不会扣款。" }, { status: 503 });
  const order = await billingRpc<BillingOrder>("create_order", { ...args, p_amount: body.amountFen });
  const checkout = await createWechatCheckout(order);
  return NextResponse.json({ order: publicOrder(order), codeUrl: checkout.code_url });
 } catch (error) {
  const message = error instanceof Error ? error.message : "";
  const known: Record<string, string> = {
   "quote changed": "抵扣金额已变化，请重新确认订单。",
   "downgrade available after expiry": "当前套餐到期后才能购买较低档位。",
   "annual to monthly available after expiry": "年付期间可升级年付套餐，或购买补充点数；到期后可改为月付。",
   "topup requires same annual plan": "补充点数仅适用于当前年付套餐。",
   "remaining value exceeds new price": "当前权益价值超过新套餐价格，请保留当前套餐并联系支持。",
   "too many orders": "创建订单过于频繁，请稍后再试。",
   "purchase unavailable": "当前账号无需或暂不能购买套餐。",
  };
  return NextResponse.json({ error: known[message] || "订单暂时未完成，请稍后查看订单状态后重试。", code: "billing_unavailable" }, { status: 409 });
 }
}
