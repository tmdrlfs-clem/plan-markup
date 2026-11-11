"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { readAuthState } from "@/lib/auth";
import { getClientIp } from "@/lib/auth/client-ip";
import { requestPasswordReset, sessionCameFromRecovery, setNewPassword } from "@/lib/auth/password-reset";
import { isPwnedPassword } from "@/lib/auth/pwned";
import { checkResetRateLimit, type RateLimitDecision } from "@/lib/auth/rate-limit";
import { sanitizeNextPath } from "@/lib/auth/redirect";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { logger } from "@/lib/logger";
import type { ResultCode } from "@/lib/result";
import { PASSWORD_MESSAGES, SignUpSchema } from "./sign-up-schema";

export type ForgotState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; code: ResultCode; message: string; fieldErrors?: { email?: string } };

export type ResetState =
  | { status: "idle" }
  | { status: "error"; code: ResultCode; message: string; fieldErrors?: { password?: string } };

const MESSAGES = {
  invalidInput: "Check the highlighted fields.",
  challenge: "We couldn't confirm you're a person. Complete the check and try again.",
  unavailable: "Password reset is unavailable right now. Try again shortly.",
  linkNeeded: "Open the reset link from your email to set a new password. Links last one hour.",
  same: "Choose a password different from your current one.",
} as const;

const EmailOnly = SignUpSchema.pick({ email: true });
const PasswordOnly = SignUpSchema.pick({ password: true });

function formString(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

function rateLimitedMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many reset requests. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

/**
 * "Forgot password" (Story 10.2). The answer is the same whether or not the
 * email has an account (NFR16).
 */
export async function requestReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const parsed = EmailOnly.safeParse({ email: formString(formData, "email") ?? "" });
  if (!parsed.success) {
    const fields = z.flattenError(parsed.error).fieldErrors;
    return { status: "error", code: "INVALID_INPUT", message: MESSAGES.invalidInput, fieldErrors: { email: fields.email?.[0] } };
  }
  const { email } = parsed.data;
  const ip = getClientIp(await headers());

  let decision: RateLimitDecision;
  try {
    decision = await checkResetRateLimit({ ip, email });
  } catch (error) {
    logger.error("auth.rate_limiter_failed", { error: error instanceof Error ? error : null });
    return { status: "error", code: "INTERNAL", message: MESSAGES.unavailable };
  }
  if (!decision.allowed) {
    return { status: "error", code: "RATE_LIMITED", message: rateLimitedMessage(decision.retryAfterSeconds) };
  }

  const challenge = await verifyTurnstile(formString(formData, "cf-turnstile-response"), ip);
  if (challenge === "failed") return { status: "error", code: "FORBIDDEN", message: MESSAGES.challenge };
  if (challenge === "unavailable") return { status: "error", code: "INTERNAL", message: MESSAGES.unavailable };

  const outcome = await requestPasswordReset(email);
  if (outcome === "ok") return { status: "sent", email };
  if (outcome === "rate_limited") return { status: "error", code: "RATE_LIMITED", message: rateLimitedMessage(3600) };
  return { status: "error", code: "INTERNAL", message: MESSAGES.unavailable };
}

/**
 * Sets a new password from a reset link's session (Story 10.2). Ends the
 * user's other sessions (NFR17), then redirects through the allowlist (NFR19).
 */
export async function resetPassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const parsed = PasswordOnly.safeParse({ password: formString(formData, "password") ?? "" });
  if (!parsed.success) {
    const fields = z.flattenError(parsed.error).fieldErrors;
    return {
      status: "error",
      code: "INVALID_INPUT",
      message: MESSAGES.invalidInput,
      fieldErrors: { password: fields.password?.[0] },
    };
  }
  const { password } = parsed.data;

  // Only a session opened from the reset link may set a password this way.
  if (!(await sessionCameFromRecovery())) {
    return { status: "error", code: "UNAUTHENTICATED", message: MESSAGES.linkNeeded };
  }
  if (await isPwnedPassword(password)) {
    return { status: "error", code: "INVALID_INPUT", message: MESSAGES.invalidInput, fieldErrors: { password: PASSWORD_MESSAGES.pwned } };
  }
  const outcome = await setNewPassword(password);
  if (!outcome.ok) {
    if (outcome.reason === "same_password") {
      return { status: "error", code: "INVALID_INPUT", message: MESSAGES.invalidInput, fieldErrors: { password: MESSAGES.same } };
    }
    if (outcome.reason === "weak_password") {
      return { status: "error", code: "INVALID_INPUT", message: MESSAGES.invalidInput, fieldErrors: { password: PASSWORD_MESSAGES.pwned } };
    }
    return { status: "error", code: "INTERNAL", message: MESSAGES.unavailable };
  }

  const state = await readAuthState();
  if (state.kind === "active") redirect(sanitizeNextPath(formString(formData, "next")));
  if (state.kind === "inactive") redirect("/pending-activation");
  redirect("/sign-in");
}
