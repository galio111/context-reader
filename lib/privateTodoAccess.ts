import "server-only";
import { NextResponse } from "next/server";
import { accountFetch } from "@/lib/accountStore";
import { getVerifiedBrowserUser } from "@/lib/userAuth";

type Access = { kind: "owner"; id: string } | { kind: "guest" | "denied" | "unavailable" };
export const todoPrivateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };

export async function privateTodoAccess(allowRefresh = true): Promise<Access> {
  try {
    const user = await getVerifiedBrowserUser(allowRefresh);
    if (!user) return { kind: "guest" };
    const allowed = await accountFetch<boolean>("rpc/personal_todo_owner_active", {
      method: "POST",
      body: JSON.stringify({ p_user_id: user.id }),
    });
    return allowed === true ? { kind: "owner", id: user.id } : { kind: "denied" };
  } catch {
    return { kind: "unavailable" };
  }
}

export function todoResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: todoPrivateHeaders });
}

export function todoAccessFailure(kind: "guest" | "denied" | "unavailable") {
  if (kind === "guest") return todoResponse({ error: "请先登录站主账号。", code: "login_required" }, 401);
  if (kind === "denied") return todoResponse({ error: "此账号没有私人待办权限。", code: "forbidden" }, 403);
  return todoResponse({ error: "暂时无法读取待办，请稍后重试。" }, 503);
}
