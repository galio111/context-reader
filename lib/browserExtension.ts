import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { accountFetch } from "@/lib/accountStore";
import { getExtensionAccountUser } from "@/lib/userAuth";

export class ExtensionAuthError extends Error {}
export interface ExtensionConnectionRow {
  id: string; user_id: string; label: string; created_at: string; expires_at: string; revoked_at: string | null;
}
export const extensionTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export async function createExtensionConnection(userId: string, label: string) {
  const token = `crx_${randomBytes(32).toString("base64url")}`;
  const connection = { id: randomUUID(), user_id: userId, label: label.trim().slice(0, 60) || "Chrome",
    created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 90 * 86400000).toISOString(), revoked_at: null };
  await accountFetch("browser_extension_connections", { method: "POST", body: JSON.stringify({ ...connection, token_hash: extensionTokenHash(token) }) });
  return { token, connection };
}
export async function authenticateExtension(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (crx_[\w-]{43})$/)?.[1];
  if (!token) throw new ExtensionAuthError("请先在网站连接扩展保存账号。");
  const rows = await accountFetch<ExtensionConnectionRow[]>(`browser_extension_connections?token_hash=eq.${extensionTokenHash(token)}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,user_id,label,created_at,expires_at,revoked_at&limit=1`);
  const row = rows[0];
  if (!row) throw new ExtensionAuthError("扩展连接已过期或被解除，请到网站重新连接。");
  const profiles = await accountFetch<Array<{ status: string; nickname: string }>>(`account_profiles?user_id=eq.${encodeURIComponent(row.user_id)}&select=status,nickname&limit=1`);
  if (profiles[0]?.status !== "active") throw new ExtensionAuthError("当前保存账号不可用，请到网站检查账号状态。");
  const user = await getExtensionAccountUser(row.user_id);
  if (!user) throw new ExtensionAuthError("当前保存账号不可用，请重新连接。");
  return { user, connection: row, nickname: profiles[0].nickname };
}
