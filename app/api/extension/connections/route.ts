import { NextResponse } from "next/server";
import { accountFetch } from "@/lib/accountStore";
import { getAuthenticatedExtensionTarget } from "@/lib/userAuth";
import { createExtensionConnection, type ExtensionConnectionRow } from "@/lib/browserExtension";
import { readJsonBody } from "@/lib/limitedBody";
import { requestExternalOrigin } from "@/lib/requestSecurity";

export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(request: Request) {
  const user = await getAuthenticatedExtensionTarget(new URL(request.url).searchParams.get("accountId") || undefined);
  if (!user) return json({ error: "请先登录网站，再设置扩展保存账号。" }, 401);
  const connections = await accountFetch<ExtensionConnectionRow[]>(`browser_extension_connections?user_id=eq.${encodeURIComponent(user.id)}&revoked_at=is.null&select=id,user_id,label,created_at,expires_at,revoked_at&order=created_at.desc&limit=50`);
  return json({ connections });
}
async function mutate(request: Request, revoke: boolean) {
  if (request.headers.get("origin") !== requestExternalOrigin(request)) return json({ error: "请从网站设置扩展。" }, 403);
  let body: Record<string, unknown>;
  try { body = await readJsonBody(request, 2048); } catch { return json({ error: "设置内容无效。" }, 400); }
  const user = await getAuthenticatedExtensionTarget(typeof body.accountId === "string" ? body.accountId : undefined);
  if (!user) return json({ error: "请先登录所选账号。" }, 401);
  if (revoke) {
    if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) return json({ error: "请选择要解除的连接。" }, 400);
    await accountFetch(`browser_extension_connections?id=eq.${body.id}&user_id=eq.${encodeURIComponent(user.id)}`, { method: "PATCH", body: JSON.stringify({ revoked_at: new Date().toISOString() }) });
    return json({ ok: true });
  }
  const profiles = await accountFetch<Array<{status: string}>>(`account_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=status&limit=1`);
  if (profiles[0]?.status !== "active") return json({ error: "所选账号当前不可用。" }, 403);
  const result = await createExtensionConnection(user.id, typeof body.label === "string" ? body.label : "Chrome");
  return json({ ...result, account: { id: user.id, nickname: String(user.user_metadata?.nickname || "当前账号") } });
}
export const POST = (request: Request) => mutate(request, false);
export const DELETE = (request: Request) => mutate(request, true);
