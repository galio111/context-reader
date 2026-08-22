import { NextResponse } from "next/server";
import { accountFetch } from "@/lib/accountStore";
import { getAdminAccessMode } from "@/lib/adminAuth";
import {
  generateInvitationCode,
  invitationCodeHash,
  invitationCodeHint,
} from "@/lib/invitationCodes";
import { readJsonBody } from "@/lib/limitedBody";
import type { AccountPlanId } from "@/types/account";

const INVITATION_PLANS = new Set<AccountPlanId>(["basic", "plus", "max"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface InvitationCodeRow {
  id: string;
  code_hint: string;
  plan_id: AccountPlanId;
  duration_days: number;
  redeem_by: string | null;
  note: string;
  created_by: string;
  created_at: string;
  revoked_at: string | null;
  redeemed_at: string | null;
  redeemed_by: string | null;
  grant_ends_at: string | null;
}

const INVITATION_SELECT = "id,code_hint,plan_id,duration_days,redeem_by,note,created_by,created_at,revoked_at,redeemed_at,redeemed_by,grant_ends_at";

function parseRedeemBy(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T23:59:59.999+08:00`);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) return undefined;
  return parsed.toISOString();
}

async function writeAudit(accessMode: "developer" | "password", action: string, targetId: string, value: Record<string, unknown>) {
  await accountFetch("admin_audit_logs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([{
      admin_label: `${accessMode}-admin`,
      action,
      target_type: "invitation_code",
      target_id: targetId,
      after_value: value,
    }]),
  });
}

export async function GET() {
  const accessMode = await getAdminAccessMode();
  if (!accessMode) return NextResponse.json({ error: "未登录管理员。" }, { status: 401 });
  const codes = await accountFetch<InvitationCodeRow[]>(
    `invitation_codes?select=${INVITATION_SELECT}&order=created_at.desc&limit=300`,
  );
  return NextResponse.json({ codes }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const accessMode = await getAdminAccessMode();
  if (!accessMode) return NextResponse.json({ error: "未登录管理员。" }, { status: 401 });
  const body = await readJsonBody<Record<string, unknown>>(request, 16 * 1024).catch(() => null);
  const planId = typeof body?.planId === "string" ? body.planId as AccountPlanId : null;
  const durationDays = Number(body?.durationDays);
  const redeemBy = parseRedeemBy(body?.redeemBy);
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 160) : "";

  if (!planId || !INVITATION_PLANS.has(planId)) {
    return NextResponse.json({ error: "请选择 Basic、Plus 或 Max。" }, { status: 400 });
  }
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
    return NextResponse.json({ error: "使用期限必须是 1 到 3650 天的整数。" }, { status: 400 });
  }
  if (redeemBy === undefined) {
    return NextResponse.json({ error: "兑换截止日期必须晚于今天。" }, { status: 400 });
  }

  let code = "";
  let created: InvitationCodeRow | undefined;
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    code = generateInvitationCode();
    try {
      const rows = await accountFetch<InvitationCodeRow[]>(`invitation_codes?select=${INVITATION_SELECT}`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([{
          code_hash: invitationCodeHash(code),
          code_hint: invitationCodeHint(code),
          plan_id: planId,
          duration_days: durationDays,
          redeem_by: redeemBy,
          note,
          created_by: `${accessMode}-admin`,
        }]),
      });
      created = rows[0];
    } catch (error) {
      if (attempt === 2 || !(error instanceof Error) || !/duplicate|unique/i.test(error.message)) throw error;
    }
  }
  if (!created) return NextResponse.json({ error: "邀请码生成失败，请重试。" }, { status: 503 });

  await writeAudit(accessMode, "create_invitation_code", created.id, {
    planId,
    durationDays,
    redeemBy,
    note,
  });
  return NextResponse.json({ code, invitation: created }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const accessMode = await getAdminAccessMode();
  if (!accessMode) return NextResponse.json({ error: "未登录管理员。" }, { status: 401 });
  const body = await readJsonBody<Record<string, unknown>>(request, 8 * 1024).catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (body?.action !== "revoke" || !UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "邀请码操作无效。" }, { status: 400 });
  }

  const revokedAt = new Date().toISOString();
  const rows = await accountFetch<InvitationCodeRow[]>(
    `invitation_codes?id=eq.${encodeURIComponent(id)}&redeemed_at=is.null&revoked_at=is.null&select=${INVITATION_SELECT}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ revoked_at: revokedAt }),
    },
  );
  if (!rows[0]) {
    return NextResponse.json({ error: "邀请码不存在、已兑换或已经停用。" }, { status: 409 });
  }
  await writeAudit(accessMode, "revoke_invitation_code", id, { revokedAt });
  return NextResponse.json({ invitation: rows[0] }, { headers: { "Cache-Control": "private, no-store" } });
}
