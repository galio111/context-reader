"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ClearableField from "@/components/ClearableField";

type InvitationPlanId = "basic" | "plus" | "max";

interface InvitationCodeRow {
  id: string;
  code_hint: string;
  plan_id: InvitationPlanId;
  duration_days: number;
  redeem_by: string | null;
  note: string;
  created_at: string;
  revoked_at: string | null;
  redeemed_at: string | null;
  redeemed_by: string | null;
  grant_ends_at: string | null;
}

interface CreatedInvitation {
  code: string;
  invitation: InvitationCodeRow;
}

const planLabels: Record<InvitationPlanId, string> = {
  basic: "Basic",
  plus: "Plus",
  max: "Max",
};

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatDateTime(value: string | null): string {
  return value ? dateTimeFormatter.format(new Date(value)) : "不限";
}

function shanghaiDate(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function codeStatus(code: InvitationCodeRow): { label: string; className: string } {
  if (code.redeemed_at) return { label: "已兑换", className: "bg-[#e9f5ee] text-[#17613b]" };
  if (code.revoked_at) return { label: "已停用", className: "bg-[#f1f2f4] text-[#5b626a]" };
  if (code.redeem_by && Date.parse(code.redeem_by) <= Date.now()) {
    return { label: "已过期", className: "bg-[#fff3e4] text-[#82551a]" };
  }
  return { label: "待兑换", className: "bg-[#e8f2fb] text-[#175a8d]" };
}

function profileDisplayName(profile: Record<string, unknown> | undefined, fallback: string): string {
  if (!profile) return fallback;
  const name = String(profile.nickname || profile.phone || profile.email || "").trim();
  return name || fallback;
}

export default function AdminInvitationCodesPanel({ profiles }: { profiles: Array<Record<string, unknown>> }) {
  const [codes, setCodes] = useState<InvitationCodeRow[] | null>(null);
  const [planId, setPlanId] = useState<InvitationPlanId>("plus");
  const [durationDays, setDurationDays] = useState("30");
  const [redeemBy, setRedeemBy] = useState("");
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const profileByUser = useMemo(
    () => new Map(profiles.map((profile) => [String(profile.user_id), profile])),
    [profiles],
  );

  const loadCodes = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/invitation-codes", { cache: "no-store" });
      const data = await response.json().catch(() => null) as { codes?: InvitationCodeRow[]; error?: string } | null;
      if (!response.ok || !data?.codes) throw new Error(data?.error || "邀请码读取失败。");
      setCodes(data.codes);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "邀请码读取失败。");
    }
  }, []);

  useEffect(() => { void loadCodes(); }, [loadCodes]);

  async function createCode() {
    const parsedDuration = Number(durationDays);
    if (!Number.isInteger(parsedDuration) || parsedDuration < 1 || parsedDuration > 3650) {
      setError("使用期限请填写 1 到 3650 天的整数。");
      return;
    }
    setCreating(true);
    setCreated(null);
    setCopyState("idle");
    setError("");
    try {
      const response = await fetch("/api/admin/invitation-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, durationDays: parsedDuration, redeemBy: redeemBy || null, note }),
      });
      const data = await response.json().catch(() => null) as CreatedInvitation & { error?: string } | null;
      if (!response.ok || !data?.code || !data.invitation) throw new Error(data?.error || "邀请码生成失败。");
      setCreated({ code: data.code, invitation: data.invitation });
      setNote("");
      await loadCodes();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "邀请码生成失败。");
    } finally {
      setCreating(false);
    }
  }

  async function copyCreatedCode() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.code);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  async function revokeCode(code: InvitationCodeRow) {
    if (!window.confirm(`确定停用 ${code.code_hint} 的邀请码吗？停用后用户将无法兑换。`)) return;
    setRevokingId(code.id);
    setError("");
    try {
      const response = await fetch("/api/admin/invitation-codes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", id: code.id }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "邀请码停用失败。");
      await loadCodes();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "邀请码停用失败。");
    } finally {
      setRevokingId("");
    }
  }

  return (
    <section className="mt-6 overflow-hidden rounded-2xl bg-white">
      <div className="border-b border-[#e1e5e9] px-5 py-5">
        <h3 className="text-[21px] font-semibold">制作邀请码</h3>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[#4d535a]">每次生成一个只可兑换一次的随机码。用户兑换后，权益从兑换当天开始计算；到期后自动恢复免费档位。</p>
      </div>

      <div className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(150px,.7fr)_minmax(150px,.7fr)_minmax(190px,1fr)_minmax(220px,1.4fr)_auto] lg:items-end">
        <label className="text-sm font-medium text-[#343a40]">兑换档位
          <select className="mt-2 block min-h-11 w-full rounded-xl border border-[#c9ced6] bg-white px-3.5 outline-none focus:border-[#1769aa] focus:ring-2 focus:ring-[#1769aa]/15" value={planId} onChange={(event) => setPlanId(event.target.value as InvitationPlanId)}>
            <option value="basic">Basic</option>
            <option value="plus">Plus</option>
            <option value="max">Max</option>
          </select>
        </label>
        <label className="text-sm font-medium text-[#343a40]">兑换后可用
          <span className="mt-2 flex min-h-11 overflow-hidden rounded-xl border border-[#c9ced6] bg-white focus-within:border-[#1769aa] focus-within:ring-2 focus-within:ring-[#1769aa]/15">
            <input className="min-w-0 flex-1 px-3.5 text-base outline-none" type="number" min="1" max="3650" step="1" inputMode="numeric" value={durationDays} onChange={(event) => setDurationDays(event.target.value)} />
            <span className="flex items-center bg-[#f3f5f7] px-3 text-xs text-[#59636c]">天</span>
          </span>
        </label>
        <label className="text-sm font-medium text-[#343a40]">兑换截止（可不填）
          <input className="mt-2 block min-h-11 w-full rounded-xl border border-[#c9ced6] bg-white px-3.5 outline-none focus:border-[#1769aa] focus:ring-2 focus:ring-[#1769aa]/15" type="date" min={shanghaiDate()} value={redeemBy} onChange={(event) => setRedeemBy(event.target.value)} />
        </label>
        <label className="text-sm font-medium text-[#343a40]">备注（可不填）
          <ClearableField className="mt-2" value={note} onClear={() => setNote("")} label="清空邀请码备注">
            <input className="block min-h-11 w-full rounded-xl border border-[#c9ced6] px-3.5 outline-none focus:border-[#1769aa] focus:ring-2 focus:ring-[#1769aa]/15" value={note} maxLength={160} onChange={(event) => setNote(event.target.value)} placeholder="用户昵称或投放批次" />
          </ClearableField>
        </label>
        <button className="min-h-11 rounded-full bg-[#1769aa] px-5 text-sm font-medium text-white hover:bg-[#10598f] disabled:bg-[#aeb8c2]" type="button" disabled={creating} onClick={() => void createCode()}>
          {creating ? "正在生成..." : "生成邀请码"}
        </button>
      </div>

      {error && <p className="mx-5 mb-5 rounded-xl bg-red-50 px-4 py-3 text-sm leading-6 text-red-700" role="alert">{error}</p>}
      {created && (
        <div className="mx-5 mb-5 flex flex-col gap-4 rounded-xl bg-[#edf5fb] px-4 py-4 text-[#174d73] sm:flex-row sm:items-center sm:justify-between" role="status">
          <div>
            <p className="text-xs">邀请码只显示这一次，请复制后单独发给用户</p>
            <strong className="mt-1 block break-all font-mono text-xl tracking-[.08em] text-[#123f61]">{created.code}</strong>
            <p className="mt-1 text-xs">{planLabels[created.invitation.plan_id]} · {created.invitation.duration_days} 天{created.invitation.redeem_by ? ` · ${formatDateTime(created.invitation.redeem_by)} 前兑换` : ""}</p>
          </div>
          <button className="min-h-10 shrink-0 rounded-full bg-white px-4 text-sm font-medium text-[#175a8d] hover:bg-[#f8fbfd]" type="button" onClick={() => void copyCreatedCode()}>
            {copyState === "copied" ? "已复制" : copyState === "error" ? "复制失败，请手动复制" : "复制邀请码"}
          </button>
        </div>
      )}

      <div className="border-t border-[#e1e5e9]">
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <div><h4 className="font-semibold">最近生成</h4><p className="mt-1 text-xs text-[#68717a]">为了安全，历史记录只显示末四位，完整邀请码不会被保存。</p></div>
          <button className="min-h-9 rounded-full border border-[#b8c7d5] px-3 text-sm text-[#175a8d] hover:bg-[#edf5fb]" type="button" onClick={() => void loadCodes()}>刷新</button>
        </div>
        {codes === null ? (
          <div className="grid gap-2 px-5 pb-5" aria-label="正在读取邀请码">{[0, 1].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-[#f3f5f7] motion-reduce:animate-none" />)}</div>
        ) : codes.length === 0 ? (
          <div className="px-5 py-10 text-center"><strong>还没有邀请码</strong><p className="mt-2 text-sm text-[#68717a]">选择档位和期限，生成第一个用户邀请码。</p></div>
        ) : (
          <ul className="divide-y divide-[#e1e5e9]">
            {codes.map((code) => {
              const status = codeStatus(code);
              const redeemedName = code.redeemed_by ? profileDisplayName(profileByUser.get(code.redeemed_by), code.redeemed_by) : "";
              return (
                <li key={code.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="font-mono text-sm tracking-[.04em]">{code.code_hint}</strong>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}>{status.label}</span>
                      <span className="text-sm font-medium text-[#175a8d]">{planLabels[code.plan_id]} · {code.duration_days} 天</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[#68717a]">
                      {code.note || "无备注"} · 创建于 {formatDateTime(code.created_at)} · 兑换截止 {formatDateTime(code.redeem_by)}
                    </p>
                    {code.redeemed_at && <p className="mt-1 text-xs leading-5 text-[#4d535a]">由 {redeemedName} 于 {formatDateTime(code.redeemed_at)} 兑换，权益至 {formatDateTime(code.grant_ends_at)}</p>}
                  </div>
                  {!code.redeemed_at && !code.revoked_at && (!code.redeem_by || Date.parse(code.redeem_by) > Date.now()) && (
                    <button className="min-h-9 shrink-0 self-start rounded-full px-3 text-sm text-red-700 hover:bg-red-50 disabled:text-[#8d969d] lg:self-auto" type="button" disabled={revokingId === code.id} onClick={() => void revokeCode(code)}>
                      {revokingId === code.id ? "正在停用..." : "停用邀请码"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
