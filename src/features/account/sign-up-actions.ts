"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { getClientIp } from "@/lib/auth/client-ip";
import { isPwnedPassword } from "@/lib/auth/pwned";
import { checkSignUpRateLimit, type RateLimitDecision } from "@/lib/auth/rate-limit";
import { signUpWithPassword } from "@/lib/auth/sign-up";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { logger } from "@/lib/logger";
import type { ResultCode } from "@/lib/result";
import { PASSWORD_MESSAGES, SignUpSchema } from "./sign-up-schema";

export type SignUpFieldErrors = { email?: string; password?: string };

export type SignUpState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; code: ResultCode; message: string; fieldErrors?: SignUpFieldErrors };

const MESSAGES = {
  invalidInput: "Check the highlighted fields.",
  challenge: "We couldn't confirm you're a person. Complete the check and try again.",
  unavailable: "Sign-up is unavailable right now. Try again shortly.",
} as const;

function rateLimitedMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many sign-up attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

function formString(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/**
 * Sign-up server action (Story 10.1). Public by nature. The answer is the same
 * whether or not the email already has an account (NFR16): "check your email".
 */
export async function signUp(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  // 1. Parse.
  const parsed = SignUpSchema.safeParse({
    email: formString(formData, "email") ?? "",
    password: formString(formData, "password") ?? "",
  });
  if (!parsed.success) {
    const fields = z.flattenError(parsed.error).fieldErrors;
    return {
      status: "error",
      code: "INVALID_INPUT",
      message: MESSAGES.invalidInput,
      fieldErrors: { email: fields.email?.[0], password: fields.password?.[0] },
    };
  }
  const { email, password } = parsed.data;
  const ip = getClientIp(await headers());

  // 2. Rate limit. Fails closed.
  let decision: RateLimitDecision;
  try {
    decision = await checkSignUpRateLimit({ ip, email });
  } catch (error) {
    logger.error("auth.rate_limiter_failed", { error: error instanceof Error ? error : null });
    return { status: "error", code: "INTERNAL", message: MESSAGES.unavailable };
  }
  if (!decision.allowed) {
    return { status: "error", code: "RATE_LIMITED", message: rateLimitedMessage(decision.retryAfterSeconds) };
  }

  // 3. Turnstile.
  const challenge = await verifyTurnstile(formString(formData, "cf-turnstile-response"), ip);
  if (challenge === "failed") return { status: "error", code: "FORBIDDEN", message: MESSAGES.challenge };
  if (challenge === "unavailable") return { status: "error", code: "INTERNAL", message: MESSAGES.unavailable };

  // 4. Leaked-password check (fails open).
  if (await isPwnedPassword(password)) {
    return {
      status: "error",
      code: "INVALID_INPUT",
      message: MESSAGES.invalidInput,
      fieldErrors: { password: PASSWORD_MESSAGES.pwned },
    };
  }

  // 5. Supabase sign-up.
  const outcome = await signUpWithPassword(email, password);
  if (outcome.ok) return { status: "sent", email };
  switch (outcome.reason) {
    case "weak_password":
      return {
        status: "error",
        code: "INVALID_INPUT",
        message: MESSAGES.invalidInput,
        fieldErrors: { password: PASSWORD_MESSAGES.pwned },
      };
    case "invalid_email":
      return {
        status: "error",
        code: "INVALID_INPUT",
        message: MESSAGES.invalidInput,
        fieldErrors: { email: "Enter a valid email address." },
      };
    case "rate_limited":
      return { status: "error", code: "RATE_LIMITED", message: rateLimitedMessage(3600) };
    default:
      return { status: "error", code: "INTERNAL", message: MESSAGES.unavailable };
  }
}
