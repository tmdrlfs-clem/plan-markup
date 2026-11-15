import "server-only";
import nodemailer from "nodemailer";
import { logger } from "@/lib/logger";

// Story 10.4: the mail the app sends itself (Auth sends its own: confirmation,
// reset, email change). One SMTP account, set by environment variables; with
// none set the app sends nothing and says so, and the caller carries on.

export type MailConfig = {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  /** The site's public origin, without a trailing slash: links in mail start here. */
  appUrl: string;
};

type Env = Record<string, string | undefined>;

/** The mail settings, or null when SMTP_HOST, EMAIL_FROM or APP_URL is missing or invalid. */
export function mailConfig(env: Env = process.env): MailConfig | null {
  const host = env.SMTP_HOST?.trim();
  const from = env.EMAIL_FROM?.trim();
  const rawUrl = env.APP_URL?.trim();
  if (!host || !from || !rawUrl) return null;
  let appUrl: string;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    appUrl = url.origin;
  } catch {
    return null;
  }
  const port = Number(env.SMTP_PORT ?? "587");
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const user = env.SMTP_USER?.trim() || undefined;
  const pass = env.SMTP_PASS || undefined;
  return { host, port, user, pass, from, appUrl };
}

export type Mail = { to: string; subject: string; text: string; html: string };

export type MailOutcome = "sent" | "not_configured" | "failed";

type Transport = { sendMail(message: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown> };

function createTransport(config: MailConfig): Transport {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // 465 is TLS from the first byte; other ports upgrade with STARTTLS when offered.
    secure: config.port === 465,
    auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

/**
 * Sends one message. Never throws: a failure is logged (without the address
 * or the body) and reported as "failed", so the caller's own work stands.
 */
export async function sendMail(
  mail: Mail,
  { config = mailConfig(), transport }: { config?: MailConfig | null; transport?: Transport } = {},
): Promise<MailOutcome> {
  if (!config) {
    logger.warn("mail.not_configured", { subject: mail.subject });
    return "not_configured";
  }
  try {
    await (transport ?? createTransport(config)).sendMail({ from: config.from, ...mail });
    return "sent";
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    logger.error("mail.send_failed", {
      subject: mail.subject,
      code: typeof code === "string" ? code : undefined,
      error: error instanceof Error ? new Error(error.name) : new Error("mail send failed"),
    });
    return "failed";
  }
}
