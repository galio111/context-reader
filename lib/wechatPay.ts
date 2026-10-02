import { createDecipheriv, createSign, createVerify, randomBytes } from "node:crypto";
import type { BillingOrder } from "@/lib/billingStore";
import { billingRpc } from "@/lib/billingStore";

const pem = (name: string) => (process.env[name] || "").replace(/\\n/g, "\n");
export function wechatReady(): boolean {
  return process.env.WECHAT_PAY_ENABLED === "true" && ["WECHAT_PAY_APP_ID", "WECHAT_PAY_MCH_ID", "WECHAT_PAY_SERIAL", "WECHAT_PAY_PRIVATE_KEY", "WECHAT_PAY_PUBLIC_KEY_ID", "WECHAT_PAY_PUBLIC_KEY", "WECHAT_PAY_API_V3_KEY", "WECHAT_PAY_NOTIFY_URL"].every(k => Boolean(process.env[k]?.trim()));
}
function config() {
  if (!wechatReady()) throw new Error("payment unavailable");
  if (Buffer.byteLength(process.env.WECHAT_PAY_API_V3_KEY!) !== 32 || !process.env.WECHAT_PAY_NOTIFY_URL!.startsWith("https://")) throw new Error("invalid payment configuration");
  return { appid: process.env.WECHAT_PAY_APP_ID!, mchid: process.env.WECHAT_PAY_MCH_ID! };
}
export function verifyWechat(headers: Headers, body: string): void {
  const timestamp = headers.get("wechatpay-timestamp") || "";
  const nonce = headers.get("wechatpay-nonce") || "";
  const signature = headers.get("wechatpay-signature") || "";
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !nonce || headers.get("wechatpay-serial") !== process.env.WECHAT_PAY_PUBLIC_KEY_ID) throw new Error("invalid payment signature headers");
  const v = createVerify("RSA-SHA256"); v.update(`${timestamp}\n${nonce}\n${body}\n`); v.end();
  if (!v.verify(pem("WECHAT_PAY_PUBLIC_KEY"), signature, "base64")) throw new Error("invalid payment signature");
}
export async function wechatRequest<T>(method: "GET" | "POST", path: string, data?: unknown): Promise<T> {
  const c = config(); const body = data === undefined ? "" : JSON.stringify(data);
  const nonce = randomBytes(16).toString("hex"); const timestamp = String(Math.floor(Date.now() / 1000));
  const signer = createSign("RSA-SHA256"); signer.update(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`); signer.end();
  const signature = signer.sign(pem("WECHAT_PAY_PRIVATE_KEY"), "base64");
  const response = await fetch(`https://api.mch.weixin.qq.com${path}`, { method, headers: { Accept: "application/json", "Content-Type": "application/json", "Wechatpay-Serial": process.env.WECHAT_PAY_PUBLIC_KEY_ID!, Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${c.mchid}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${process.env.WECHAT_PAY_SERIAL}",signature="${signature}"` }, ...(body ? { body } : {}), cache: "no-store", signal: AbortSignal.timeout(12000) });
  const raw = await response.text(); verifyWechat(response.headers, raw);
  if (!response.ok) throw new Error(`wechat request rejected (${response.status})`);
  return (raw ? JSON.parse(raw) : null) as T;
}
export async function createWechatCheckout(order: BillingOrder) {
  const c = config();
  return wechatRequest<{ code_url: string }>("POST", "/v3/pay/transactions/native", {
    ...c, description: `Context Reader ${order.plan_id} ${order.kind === "topup" ? "补充点数" : order.term === "year" ? "年付会员" : "月付会员"}`,
    out_trade_no: order.id.replaceAll("-", ""), time_expire: order.expires_at,
    notify_url: process.env.WECHAT_PAY_NOTIFY_URL, amount: { total: order.amount_fen, currency: "CNY" },
  });
}
export interface WechatTransaction { appid: string; mchid: string; out_trade_no: string; transaction_id: string; trade_state: string; amount: { total: number; currency: string } }
export async function applyWechatTransaction(t: WechatTransaction): Promise<void> {
  const c = config();
  if (t.appid !== c.appid || t.mchid !== c.mchid || t.amount?.currency !== "CNY" || !Number.isSafeInteger(t.amount.total) || !/^[a-f0-9]{32}$/.test(t.out_trade_no)) throw new Error("payment identity mismatch");
  if (t.trade_state !== "SUCCESS") return;
  if (!t.transaction_id) throw new Error("missing payment transaction");
  const s = t.out_trade_no; const id = `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
  await billingRpc("settle", { p_order: id, p_transaction: t.transaction_id, p_amount: t.amount.total });
}
export async function queryWechatOrder(o: BillingOrder): Promise<void> {
  const c = config();
  const transaction = await wechatRequest<WechatTransaction>("GET", `/v3/pay/transactions/out-trade-no/${o.id.replaceAll("-", "")}?mchid=${encodeURIComponent(c.mchid)}`);
  await applyWechatTransaction(transaction);
}
export function decryptWechatNotification(body: string): WechatTransaction {
  config();
  const notification = JSON.parse(body) as { event_type: string; resource: { algorithm: string; nonce: string; associated_data: string; ciphertext: string } };
  if (notification.event_type !== "TRANSACTION.SUCCESS" || notification.resource?.algorithm !== "AEAD_AES_256_GCM") throw new Error("unsupported notification");
  const r = notification.resource; const encrypted = Buffer.from(r.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(process.env.WECHAT_PAY_API_V3_KEY!), r.nonce);
  decipher.setAAD(Buffer.from(r.associated_data || "")); decipher.setAuthTag(encrypted.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0,-16)), decipher.final()]).toString("utf8")) as WechatTransaction;
}
