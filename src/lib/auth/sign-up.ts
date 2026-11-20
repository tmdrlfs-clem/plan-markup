import "server-only";
import { confirmSignUpMail } from "@/lib/email/templates";
import { mailConfig, sendMail, type MailConfig } from "@/lib/email/mailer";
import { logger } from "@/lib/logger";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type SignUpFailure = "weak_password" | "invalid_email" | "rate_limited" | "unavailable";

export type SignUpOutcome = { ok: true } | { ok: false; reason: SignUpFailure };

type AuthErrorLike = { status?: number; code?: string };

/**
 * Maps an Auth error from making the account to a reason. An existing email
 * is never an error the caller sees (NFR16): it is answered like a new one.
 */
export function classifySignUpError(error: AuthErrorLike): SignUpFailure | "ok" {
  if (error.code === "user_already_exists" || error.code === "email_exists") return "ok";
  if (error.code === "weak_password") return "weak_password";
  if (error.code === "email_address_invalid" || error.code === "validation_failed") return "invalid_email";
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
    return "rate_limited";
  }
  return "unavailable";
}

/** The emailed link: /auth/confirm shows a button and uses the token on its POST (confirm-actions.ts). */
export function confirmationLink(appUrl: string, hashedToken: string): string {
  const params = new URLSearchParams({ token_hash: hashedToken, type: "email" });
  return `${appUrl}/auth/confirm?${params.toString()}`;
}

/**
 * Makes the auth user and emails the confirmation link; the profile starts as
 * `pending` (app.fn_handle_new_user) and no session exists until the email is
 * confirmed.
 *
 * Security review M3: public sign-up is off in Supabase Auth, so an account
 * can only be made here, after the caller's rate limit, Turnstile and
 * leaked-password checks. The service role makes it (generateLink "signup":
 * the user and a confirmation token, no email from Auth) and the app's own
 * mailer sends the link. Without mail settings nothing is made.
 *
 * Asked again for an address that is not confirmed yet, it sends a fresh link.
 */
export async function signUpWithPassword(
  email: string,
  password: string,
  { config = mailConfig() }: { config?: MailConfig | null } = {},
): Promise<SignUpOutcome> {
  if (!config) {
    logger.error("auth.sign_up_mail_not_configured");
    return { ok: false, reason: "unavailable" };
  }
  const { data, error } = await createAdminSupabase().auth.admin.generateLink({ type: "signup", email, password });
  if (error) {
    const reason = classifySignUpError(error);
    if (reason === "ok") return { ok: true };
    if (reason === "unavailable") logger.error("auth.sign_up_upstream_failed", { status: error.status, code: error.code });
    return { ok: false, reason };
  }
  const hashedToken = data.properties?.hashed_token;
  if (!hashedToken) {
    logger.error("auth.sign_up_no_token");
    return { ok: false, reason: "unavailable" };
  }
  const sent = await sendMail({ to: email, ...confirmSignUpMail({ link: confirmationLink(config.appUrl, hashedToken) }) }, { config });
  // The account waits unconfirmed; signing up again sends a new link.
  return sent === "sent" ? { ok: true } : { ok: false, reason: "unavailable" };
}
