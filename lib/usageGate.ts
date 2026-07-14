import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { reserveUsage } from "@/lib/accountStore";
import { resolveUsageIdentity, type UsageIdentity } from "@/lib/usageIdentity";
import type { UsageMetricKey, UsageReservation } from "@/types/account";

export interface UsageGateResult {
  actionId: string;
  identity: UsageIdentity;
  reservation: UsageReservation;
}

export class UsageGateError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "UsageGateError";
    this.status = status;
    this.code = code;
  }
}

function actionIdFromRequest(request: Request): string {
  const value = request.headers.get("x-context-action-id")?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : randomUUID();
}

export function deepReadingUnits(characterCount: number, minimum = 1): number {
  return Math.max(minimum, Math.ceil(Math.max(0, characterCount) / 1000));
}

export async function gateUsage(request: Request, options: {
  feature: string;
  metricKey: UsageMetricKey;
  units?: number;
  loginRequired?: boolean;
}): Promise<UsageGateResult> {
  let identity: UsageIdentity;
  try {
    identity = await resolveUsageIdentity(request);
  } catch (error) {
    console.error(
      "[usage-gate] Failed to resolve account identity:",
      error instanceof Error ? error.message : "Unknown account identity error",
    );
    if (options.loginRequired) {
      throw new UsageGateError("账号与用量服务暂未配置，请稍后再试。", 503, "account_not_configured");
    }
    const actionId = actionIdFromRequest(request);
    const fallbackIdentity: UsageIdentity = {
      ownerKey: "guest:legacy-fallback",
      planId: "guest",
      authenticated: false,
      suspended: false,
    };
    return {
      actionId,
      identity: fallbackIdentity,
      reservation: {
        allowed: true,
        used: 0,
        allowance: 10,
        remaining: 10,
        windowEnd: "",
        duplicate: false,
        actionId,
        metricKey: "guest_lookup",
      },
    };
  }

  if (identity.suspended) {
    throw new UsageGateError("此账号或游客身份已被暂停，请联系管理员。", 403, "account_suspended");
  }
  if (options.loginRequired && !identity.authenticated) {
    throw new UsageGateError("登录后才能使用此功能。", 401, "login_required");
  }

  const actionId = actionIdFromRequest(request);
  const reservation = await reserveUsage({
    actionId,
    ownerKey: identity.ownerKey,
    userId: identity.userId,
    guestId: identity.guestId,
    planId: identity.planId,
    feature: options.feature,
    metricKey: identity.authenticated ? options.metricKey : "guest_lookup",
    units: Math.max(1, Math.floor(options.units ?? 1)),
  });

  if (!reservation.allowed) {
    throw new UsageGateError(
      identity.authenticated ? "本周期额度已用完，可在用量页查看详情。" : "今天的 10 次游客试用已用完，登录后可继续查词。",
      429,
      "quota_exhausted",
    );
  }
  return { actionId, identity, reservation };
}

export function usageErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof UsageGateError)) {
    return null;
  }
  return NextResponse.json(
    { error: error.message, code: error.code },
    { status: error.status, headers: { "Cache-Control": "no-store" } },
  );
}
