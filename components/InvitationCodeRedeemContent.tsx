"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAccount } from "@/components/AccountProvider";
import styles from "./InvitationCodeRedeemContent.module.css";

const planLabels: Record<string, string> = {
  basic: "Basic",
  plus: "Plus",
  max: "Max",
};

const metricLabels: Record<string, string> = {
  lookup_generation: "AI 查词与追问",
  deep_reading: "深度阅读",
};

const expiryFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function normalizedCodeBody(value: string): string {
  const compact = value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^2-9A-HJ-NP-Z]/g, "");
  return compact.length > 12 && compact.startsWith("CR") ? compact.slice(2) : compact;
}

function formatCodeInput(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[^2-9A-HJ-NP-Z-]/g, "").slice(0, 17);
}

export default function InvitationCodeRedeemContent({ active }: { active: boolean }) {
  const { account, isOffline, openLogin, refreshAccount } = useAccount();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const activeInvite = account.authenticated
    && account.entitlement?.source === "invite"
    && Boolean(account.entitlement.endsAt)
    && Date.parse(account.entitlement.endsAt || "") > Date.now();
  const expiryText = activeInvite && account.entitlement?.endsAt
    ? expiryFormatter.format(new Date(account.entitlement.endsAt))
    : "";
  const activeNonFree = account.authenticated && !activeInvite && account.plan?.id !== "free";
  const canRedeem = account.authenticated && !account.localOnly && !activeInvite && account.plan?.id === "free";
  const planName = planLabels[account.plan?.id || ""] || account.plan?.displayName || "免费";
  const balances = useMemo(
    () => account.usage.filter((usage) => metricLabels[usage.metricKey]),
    [account.usage],
  );
  const completeCode = normalizedCodeBody(code).length === 12;

  useEffect(() => {
    if (active) return;
    setCode("");
    setMessage(null);
  }, [active]);

  async function redeem(event: FormEvent) {
    event.preventDefault();
    if (!canRedeem || submitting || isOffline) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/account/invitation-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await response.json().catch(() => null) as { error?: string; grant?: { granted_plan_id?: string; granted_ends_at?: string } } | null;
      if (!response.ok || !data?.grant) throw new Error(data?.error || "邀请码暂时无法兑换，请稍后重试。");
      await refreshAccount();
      const grantedPlan = planLabels[data.grant.granted_plan_id || ""] || "内测";
      const grantedUntil = data.grant.granted_ends_at ? expiryFormatter.format(new Date(data.grant.granted_ends_at)) : "";
      setCode("");
      setMessage({ kind: "success", text: `兑换成功，已获得 ${grantedPlan} 权益${grantedUntil ? `，有效期至 ${grantedUntil}` : ""}。` });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "邀请码暂时无法兑换，请稍后重试。" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.root} data-local-scroll-surface>
      {account.authenticated ? (
        <section className={styles.summary} aria-label="当前账号权益">
          <span>当前权益</span>
          <strong>{activeInvite ? `${planName} 内测` : planName}</strong>
          {activeInvite ? <p>有效期至 {expiryText}，到期后自动恢复免费档位。</p> : <p>当前没有生效中的邀请码权益。</p>}
          {balances.length > 0 && (
            <dl className={styles.balances}>
              {balances.map((usage) => (
                <div key={usage.metricKey}>
                  <dt>{metricLabels[usage.metricKey]}</dt>
                  <dd>{usage.remaining.toLocaleString("zh-CN")} / {usage.allowance.toLocaleString("zh-CN")} 可用</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ) : (
        <section className={styles.signedOut}>
          <strong>登录后兑换</strong>
          <p>邀请码会绑定到当前账号，在其他设备登录同一账号也可以使用对应权益。</p>
          <button className={styles.primary} type="button" onClick={() => openLogin("登录后可以兑换管理员私发的邀请码。")}>登录账号</button>
        </section>
      )}

      {account.authenticated && account.localOnly && <p className={styles.notice}>本机开发身份不连接账号服务，不能兑换邀请码。</p>}
      {account.authenticated && account.plan?.id === "admin" && <p className={styles.notice}>开发者账号已有最高权限，不需要兑换邀请码。</p>}
      {activeNonFree && account.plan?.id !== "admin" && <p className={styles.notice}>当前账号已有生效中的非免费权益，如需改用邀请码请先联系管理员。</p>}
      {activeInvite && <p className={styles.notice}>当前邀请码权益到期后，你可以在这里兑换管理员发来的新邀请码。</p>}

      {canRedeem && (
        <form className={styles.form} onSubmit={(event) => void redeem(event)}>
          <label className={styles.field}>
            <span>邀请码</span>
            <input
              value={code}
              onChange={(event) => setCode(formatCodeInput(event.target.value))}
              placeholder="例如 CR-7K9M-X2QP-6HTR"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              inputMode="text"
              aria-describedby="invitation-code-help"
            />
          </label>
          <p id="invitation-code-help" className={styles.explanation}>每个邀请码只能兑换一次。兑换成功后，档位和使用期限会立即绑定到当前账号。</p>
          <button className={styles.primary} type="submit" disabled={isOffline || submitting || !completeCode}>
            {isOffline ? "联网后可兑换" : submitting ? "正在兑换..." : "兑换邀请码"}
          </button>
        </form>
      )}

      {message && <p className={message.kind === "success" ? styles.success : styles.error} role={message.kind === "success" ? "status" : "alert"}>{message.text}</p>}
    </div>
  );
}
