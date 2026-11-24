import nodemailer from "nodemailer";

export type SiteEmailStatus = "sent" | "failed" | "not_configured";

export interface SiteEmailResult {
  status: SiteEmailStatus;
  error: string;
}

function emailConfig(): {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  recipient: string;
} {
  const host = process.env.SITE_SMTP_HOST?.trim() || process.env.ERROR_ALERT_SMTP_HOST?.trim() || "";
  const rawPort = Number(process.env.SITE_SMTP_PORT || process.env.ERROR_ALERT_SMTP_PORT || "465");
  const user = process.env.SITE_SMTP_USER?.trim() || process.env.ERROR_ALERT_SMTP_USER?.trim() || "";
  const password = process.env.SITE_SMTP_PASSWORD?.trim() || process.env.ERROR_ALERT_SMTP_PASSWORD?.trim() || "";
  const from = process.env.SITE_SMTP_FROM?.trim() || process.env.ERROR_ALERT_FROM?.trim() || user;
  const recipient = process.env.SITE_NOTIFICATION_EMAIL_TO?.trim() || "";
  return {
    host,
    port: Number.isFinite(rawPort) ? rawPort : 465,
    user,
    password,
    from,
    recipient,
  };
}

export function siteNotificationEmailStatus(): { configured: boolean; recipient: string } {
  const config = emailConfig();
  return {
    configured: Boolean(config.host && config.user && config.password && config.from && config.recipient),
    recipient: config.recipient,
  };
}

export function todoDeadlineEmailConfigured(): boolean {
  const {host, user, password, from} = emailConfig();
  return Boolean(host && user && password && from);
}

function siteTransport(config: ReturnType<typeof emailConfig>) {
  return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.password },
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 20_000,
  });
}

export async function sendSiteNotificationEmail(subject: string, text: string): Promise<SiteEmailResult> {
  const config = emailConfig();
  if (!config.host || !config.user || !config.password || !config.from || !config.recipient) {
    return { status: "not_configured", error: "服务器尚未配置站点通知邮箱。" };
  }
  try {
    const transporter = siteTransport(config);
    await transporter.sendMail({
      from: config.from,
      to: config.recipient,
      subject,
      text,
    });
    return { status: "sent", error: "" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 500) : "邮件发送失败。",
    };
  }
}

export function todoSmtpFailureOutcome(error: unknown): "retry" | "uncertain" {
  const smtp = error as {code?:string; command?:string; responseCode?:number; message?:string} | null;
  if (!smtp) return "uncertain";
  const rejected = (smtp.responseCode || 0) >= 400;
  // Nodemailer also labels mid-DATA socket losses as CONN. Only named handshake
  // stages and explicit TCP dial errors prove that SMTP couldn't accept the mail.
  const beforeData = /^(EHLO|HELO|STARTTLS|AUTH(?: .*)?|MAIL FROM|RCPT TO)$/i.test(smtp.command || "")
    || ["EDNS","EAUTH","EENVELOPE"].includes(smtp.code || "")
    || /^(Connection timeout|Greeting never received|connect (?:ECONNREFUSED|ENETUNREACH|EHOSTUNREACH)\b)/i.test(smtp.message || "");
  return rejected || beforeData ? "retry" : "uncertain";
}

export async function sendTodoDeadlineEmail(to: string, subject: string, text: string, messageId: string): Promise<"sent"|"retry"|"uncertain"> {
  const config = emailConfig();
  if (!config.host || !config.user || !config.password || !config.from) return "retry";
  try {
    const info = await siteTransport(config).sendMail({from:config.from, to, subject, text, messageId});
    return info.accepted.length ? "sent" : "retry";
  } catch (error) {
    return todoSmtpFailureOutcome(error);
  }
}
