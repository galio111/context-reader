import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { accountFetch } from "@/lib/accountStore";
import { billingCatalog, billingRpc, ownedOrder, type BillingOrder } from "@/lib/billingStore";
import { wechatReady, wechatRequest, queryWechatOrder } from "@/lib/wechatPay";
import { readJsonBody } from "@/lib/limitedBody";
export async function GET() {
 if (!(await isAdminRequest())) return NextResponse.json({ error: "无管理员权限。" }, { status: 401 });
 try {
  const [plans, orders] = await Promise.all([billingCatalog(), accountFetch<BillingOrder[]>("billing_orders?select=id,user_id,plan_id,term,kind,status,price_fen,credit_fen,amount_fen,points,created_at,expires_at,paid_at,fulfilled_at,transaction_id,review_reason&order=created_at.desc&limit=100")]);
  return NextResponse.json({ plans, orders, paymentReady: wechatReady() });
 } catch { return NextResponse.json({ error: "付费管理暂时不可用。" }, { status: 503 }); }
}
export async function POST(request: Request) {
 if (!(await isAdminRequest())) return NextResponse.json({ error: "无管理员权限。" }, { status: 401 });
 try {
  const b = await readJsonBody<Record<string, unknown>>(request, 8192);
  if (b.action === "plan") {
   if (![b.monthlyFen,b.annualFen,b.points].every(Number.isSafeInteger) || typeof b.active !== "boolean") return NextResponse.json({ error: "价格（分）和点数必须为整数。" }, { status: 400 });
   await billingRpc("update_plan", { p_plan: b.planId, p_month: b.monthlyFen, p_year: b.annualFen, p_points: b.points, p_active: b.active });
  } else if (b.action === "check_payment") {
   const order = await ownedOrder(String(b.orderId));
   if (!order) return NextResponse.json({ error: "订单不存在。" }, { status: 404 });
   if (order.status === "pending") await queryWechatOrder(order);
  } else if (b.action === "refund_review") {
   const order = await ownedOrder(String(b.orderId));
   if (!order || !["review","refunding"].includes(order.status) || order.fulfilled_at) return NextResponse.json({ error: "这里只能退还未发放权益的异常订单。" }, { status: 409 });
   const refundId = "R" + order.id.replaceAll("-","").slice(0,31);
   await accountFetch(`billing_orders?id=eq.${order.id}&status=in.(review,refunding)`, { method: "PATCH", body: JSON.stringify({ status: "refunding", refund_id: refundId }) });
   const refund = await wechatRequest<{ status: string }>("POST", "/v3/refund/domestic/refunds", { out_trade_no: order.id.replaceAll("-",""), out_refund_no: refundId, reason: "订单权益依据变化，未发放会员权益", amount: { refund: order.amount_fen, total: order.amount_fen, currency: "CNY" } });
   if (refund.status === "SUCCESS") await accountFetch(`billing_orders?id=eq.${order.id}&status=eq.refunding`, { method: "PATCH", body: JSON.stringify({ status: "refunded", refunded_at: new Date().toISOString() }) });
  } else if (b.action === "check_refund") {
   const order = await ownedOrder(String(b.orderId));
   if (!order || order.status !== "refunding") return NextResponse.json({ error: "不是退款中的订单。" }, { status: 409 });
   const r = await wechatRequest<{ status: string }>("GET", "/v3/refund/domestic/refunds/R" + order.id.replaceAll("-","").slice(0,31));
   if (r.status === "SUCCESS") await accountFetch(`billing_orders?id=eq.${order.id}&status=eq.refunding`, { method: "PATCH", body: JSON.stringify({ status: "refunded", refunded_at: new Date().toISOString() }) });
  } else return NextResponse.json({ error: "无效操作。" }, { status: 400 });
  await accountFetch("admin_audit_logs", { method: "POST", body: JSON.stringify([{ admin_label: "verified-admin", action: "billing_" + b.action, target_type: "billing", target_id: String(b.planId || b.orderId), after_value: b }]) });
  return NextResponse.json({ ok: true });
 } catch { return NextResponse.json({ error: "操作未完成，请刷新核对后重试。" }, { status: 409 }); }
}
