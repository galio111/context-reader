import { requestExternalOrigin } from "@/lib/requestSecurity";
import { NextResponse } from "next/server";
import { getAccountSessionState } from "@/lib/accountStore";
import { establishUserSession, getAuthenticatedUser, restoreSavedAccount } from "@/lib/userAuth";
import { forgetSavedAccount, listSavedAccounts } from "@/lib/savedAccountSessions";
import { readJsonBody } from "@/lib/limitedBody";

const noStore = { "Cache-Control": "private, no-store" };
export async function GET() {
  return NextResponse.json({ savedAccounts: await listSavedAccounts() }, { headers: noStore });
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== requestExternalOrigin(request)) return NextResponse.json({ error: "请从本站操作。" }, { status: 403 });
  let body: { action?: string; userId?: string };
  try { body = await readJsonBody(request, 2048); } catch { return NextResponse.json({ error: "请求格式不正确。" }, { status: 400 }); }
  if (typeof body.userId !== "string" || !["switch", "remove"].includes(body.action ?? "")) return NextResponse.json({ error: "请选择账号。" }, { status: 400 });
  try {
    if (body.action === "remove") {
      const active = await getAuthenticatedUser();
      if (active?.id === body.userId) return NextResponse.json({ error: "请先切换到另一个账号，再移除此账号。" }, { status: 409 });
      await forgetSavedAccount(body.userId);
      return NextResponse.json({ savedAccounts: await listSavedAccounts() }, { headers: noStore });
    }
    const session = await restoreSavedAccount(body.userId);
    if (!session) return NextResponse.json({ error: "此账号登录已过期，请移除后重新登录。" }, { status: 401, headers: noStore });
    const account = await getAccountSessionState(session.user);
    if (account.profile?.status !== "active") return NextResponse.json({ error: "此账号已停用。" }, { status: 403, headers: noStore });
    await establishUserSession(session);
    return NextResponse.json({ account, savedAccounts: await listSavedAccounts() }, { headers: noStore });
  } catch { return NextResponse.json({ error: "账号暂时无法切换，请重试。" }, { status: 503, headers: noStore }); }
}
