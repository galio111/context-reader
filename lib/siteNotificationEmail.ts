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

export async function sendSiteNotificationEmail(subject: string, text: string): Promise<SiteEmailResult> {
  const config = emailConfig();
  if (!config.host || !config.user || !config.password || !config.from || !config.recipient) {
    return { status: "not_configured", error: "服务器尚未配置站点通知邮箱。" };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.password },
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 20_000,
    });
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
