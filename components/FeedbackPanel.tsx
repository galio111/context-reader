"use client";

import { useEffect, useState, type FormEvent } from "react";
import ClearableField from "@/components/ClearableField";
import { describeApiFailure, describeCaughtRequestError } from "@/lib/clientErrorReporting";
import styles from "./FeedbackPanel.module.css";

export function FeedbackPanel({ open, onClose, embedded = false }: { open: boolean; onClose: () => void; embedded?: boolean }) {
  const [category, setCategory] = useState("产品建议");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!open) {
      setMessage("");
      setContact("");
      setWebsite("");
      setStatus("");
      setSent(false);
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open, submitting]);

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setStatus("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message, contact, website, page: window.location.href }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setStatus(await describeApiFailure(response, data, {
          operation: "feedback_submit",
          endpoint: "/api/feedback",
          fallbackMessage: "反馈提交失败，请稍后重试。",
        }));
        return;
      }
      setSent(true);
    } catch (error) {
      setStatus(await describeCaughtRequestError(error, {
        operation: "feedback_submit",
        endpoint: "/api/feedback",
        fallbackMessage: "反馈提交失败，请稍后重试。",
      }));
    } finally {
      setSubmitting(false);
    }
  }

  const panel = (
      <section className={`${styles.panel} ${embedded ? styles.embeddedPanel : ""}`} role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : "true"} aria-labelledby="feedback-title" data-pointer-quiet>
        <header>
          <div><span>Feedback</span><h2 id="feedback-title">告诉我哪里需要变好</h2></div>
          <button type="button" aria-label="关闭意见反馈" onClick={onClose} disabled={submitting}>×</button>
        </header>
        {sent ? (
          <div className={styles.success}>
            <i aria-hidden="true">✓</i>
            <h3>建议已经送达</h3>
            <p>内容已保存到项目的私有反馈箱，不会公开显示。</p>
            <button type="button" onClick={onClose}>返回主页</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label>类型
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option>产品建议</option><option>使用问题</option><option>文章与推荐</option><option>翻译或解释问题</option><option>界面与动效</option>
              </select>
            </label>
            <label>你的想法
              <ClearableField value={message} onClear={() => { setMessage(""); setStatus(""); }} label="清空反馈内容" multiline>
                <textarea value={message} onChange={(event) => { setMessage(event.target.value); if (status) setStatus(""); }} minLength={10} maxLength={3000} placeholder="请描述发生了什么，或你希望怎样改…" required />
              </ClearableField>
            </label>
            <label>联系方式（可不填）
              <ClearableField value={contact} onClear={() => setContact("")} label="清空联系方式">
                <input value={contact} onChange={(event) => setContact(event.target.value)} maxLength={160} placeholder="留下邮箱、微信或其他联系方式，我可以回信联系你" />
              </ClearableField>
            </label>
            <label className={styles.honeypot} aria-hidden="true">Website<input value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" /></label>
            <div className={styles.footer}>
              <span>{message.length} / 3000</span>
              <button type="submit" disabled={submitting || message.trim().length < 10}>{submitting ? "正在提交…" : "提交建议"}</button>
            </div>
            {status && <p className={styles.error} role="alert">{status}</p>}
          </form>
        )}
      </section>
  );

  if (embedded) {
    return <div className={styles.embeddedShell}>{panel}</div>;
  }

  return (
    <div className={styles.overlay} onPointerDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
      {panel}
    </div>
  );
}
