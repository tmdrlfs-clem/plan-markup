"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthState, readAuthState } from "@/lib/auth";
import { getClientIp } from "@/lib/auth/client-ip";
import { sanitizeNextPath } from "@/lib/auth/redirect";
import { checkSignInRateLimit, type RateLimitDecision } from "@/lib/auth/rate-limit";
import { signInWithPassword, signOutCurrentSession } from "@/lib/auth/sign-in";
import { logger } from "@/lib/logger";
import type { ResultCode } from "@/lib/result";
import { SignInSchema } from "./sign-in-schema";

export type SignInFieldErrors = { email?: string; password?: string };

export type SignInState =
  | { status: "idle" }
  | { status: "error"; code: ResultCode; message: string; fieldErrors?: SignInFieldErrors };

const MESSAGES = {
  invalidInput: "Check the highlighted fields.",
  invalidCredentials: "Email or password is incorrect.",
  unavailable: "Sign-in is unavailable right now. Try again shortly.",
} as const;

function rateLimitedMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many sign-in attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

function formString(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/**
 * Sign-in server action (AC 1-3, 6). Public by nature: it is the one action
 * that runs without a user, and it establishes the session.
 */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  // 1. Parse.
  const parsed = SignInSchema.safeParse({
    email: formString(formData, "email") ?? "",
    password: formString(formData, "password") ?? "",
    next: formString(formData, "next"),
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
  const { email, password, next } = parsed.data;

  // 2. Rate limit before Auth is called. Fails closed.
  let decision: RateLimitDecision;
  try {
    decision = await checkSignInRateLimit({ ip: getClientIp(await headers()), email });
  } catch (error) {
    // No email, IP or key in the log.
    logger.error("Sign-in rate limiter failed", error instanceof Error ? error.message : "unknown");
    return { status: "error", code: "INTERNAL", message: MESSAGES.unavailable };
  }
  if (!decision.allowed) {
    return {
      status: "error",
      code: "RATE_LIMITED",
      message: rateLimitedMessage(decision.retryAfterSeconds),
    };
  }

  // 3. Supabase sign-in.
  const outcome = await signInWithPassword(email, password);
  if (!outcome.ok) {
    if (outcome.reason === "invalid") {
      return { status: "error", code: "UNAUTHENTICATED", message: MESSAGES.invalidCredentials };
    }
    if (outcome.reason === "rate_limited") {
      return { status: "error", code: "RATE_LIMITED", message: rateLimitedMessage(900) };
    }
    return { status: "error", code: "INTERNAL", message: MESSAGES.unavailable };
  }

  // 4. Status check, uncached: the cached state of this request predates sign-in.
  const state = await readAuthState();

  // 5. redirect() throws a control-flow error: outside any try/catch.
  if (state.kind === "active") redirect(sanitizeNextPath(next));
  if (state.kind === "inactive") redirect("/pending-activation");
  // Signed in but the session did not verify: treat as unavailable.
  logger.error("Session not readable right after sign-in");
  return { status: "error", code: "INTERNAL", message: MESSAGES.unavailable };
}

/**
 * Sign-out server action (AC 7). The one action open to non-active users,
 * which is why it uses getAuthState() rather than getAuthUser().
 */
export async function signOut(): Promise<void> {
  const state = await getAuthState();
  if (state.kind !== "anonymous") await signOutCurrentSession();
  redirect("/sign-in");
}
