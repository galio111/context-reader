import { NextResponse } from "next/server";
import { accountFetch, getAccountSessionState } from "@/lib/accountStore";
import { invitationCodeHash, normalizeInvitationCode } from "@/lib/invitationCodes";
import { readJsonBody } from "@/lib/limitedBody";
import { getAuthenticatedUser } from "@/lib/userAuth";

interface RedeemRow {
  invitation_id: string;
  granted_plan_id: string;
  granted_starts_at: string;
  granted_ends_at: string;
}

function redemptionError(error: unknown): { message: string; status: number } {
  const detail = error instanceof Error ? error.message : "";
  if (/active_invitation_entitlement/.test(detail)) {
    return { message: "当前邀请码权益仍在有效期内，到期后可以兑换新的邀请码。", status: 409 };
  }
  if (/active_nonfree_entitlement/.test(detail)) {
    return { message: "当前账号已有生效中的非免费权益，请联系管理员确认后再兑换。", status: 409 };
  }
  if (/invitation_code_expired/.test(detail)) {
    return { message: "这个邀请码已过兑换期限，请联系管理员获取新码。", status: 410 };
  }
  if (/invitation_code_redeemed/.test(detail)) {
    return { message: "这个邀请码已经被兑换，每个邀请码只能使用一次。", status: 409 };
  }
  if (/invitation_code_revoked/.test(detail)) {
    return { message: "这个邀请码已停用，请联系管理员获取新码。", status: 410 };
  }
  if (/account_not_active/.test(detail)) {
    return { message: "当前账号已停用，暂时不能兑换邀请码。", status: 403 };
  }
  if (/invitation_code_invalid/.test(detail)) {
    return { message: "邀请码不正确，请检查后重新输入。", status: 404 };
  }
  return { message: "邀请码暂时无法兑换，请稍后重试。", status: 503 };
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "请先登录后再兑换邀请码。" }, { status: 401 });

  const body = await readJsonBody<Record<string, unknown>>(request, 8 * 1024).catch(() => null);
  const rawCode = typeof body?.code === "string" ? body.code.slice(0, 64) : "";
  const normalized = normalizeInvitationCode(rawCode);
  if (normalized.length !== 12) {
    return NextResponse.json({ error: "请输入完整的 12 位邀请码。" }, { status: 400 });
  }

  try {
    const rows = await accountFetch<RedeemRow[]>("rpc/redeem_invitation_code", {
      method: "POST",
      body: JSON.stringify({ p_user_id: user.id, p_code_hash: invitationCodeHash(rawCode) }),
    });
    const grant = rows[0];
    if (!grant) throw new Error("invitation_redemption_missing_result");
    const account = await getAccountSessionState(user);
    return NextResponse.json({ account, grant }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const mapped = redemptionError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
