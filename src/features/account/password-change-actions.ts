"use server";

import { z } from "zod";
import { getAuthUser } from "@/lib/auth";
import { checkCurrentPassword, replacePassword } from "@/lib/auth/change-password";
import { isPwnedPassword } from "@/lib/auth/pwned";
import { checkPasswordChangeRateLimit } from "@/lib/auth/rate-limit";
import { fail, internalError, type Result } from "@/lib/result";
import { PASSWORD_CHANGE_MESSAGES } from "./password-change-messages";
import { PASSWORD_MESSAGES, passwordProblem } from "./sign-up-schema";

// Settings → Account: change the password while signed in, with the current
// one. Other sessions end; this one stays (NFR17). The rules are the sign-up
// rules (NFR18) and the breach check (HIBP).

const Schema = z.strictObject({
  current: z.string().max(200),
  password: z.string().max(400),
});

export type PasswordChangeField = "current" | "password";

/** A Result, or an input problem tied to one of the two fields. */
export type ChangePasswordResult = Result<null> | { ok: false; code: "INVALID_INPUT"; message: string; field: PasswordChangeField };

export async function changePassword(input: unknown): Promise<ChangePasswordResult> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT");
  const { current, password } = parsed.data;
  if (current === "") return { ok: false, code: "INVALID_INPUT", message: PASSWORD_CHANGE_MESSAGES.current, field: "current" };
  const problem = passwordProblem(password);
  if (problem) return { ok: false, code: "INVALID_INPUT", message: problem, field: "password" };
  if (password === current) return { ok: false, code: "INVALID_INPUT", message: PASSWORD_CHANGE_MESSAGES.same, field: "password" };

  try {
    const decision = await checkPasswordChangeRateLimit(user.id);
    if (!decision.allowed) return fail("RATE_LIMITED", PASSWORD_CHANGE_MESSAGES.tooMany);
    const check = await checkCurrentPassword(user.email, current);
    if (check === "wrong") return { ok: false, code: "INVALID_INPUT", message: PASSWORD_CHANGE_MESSAGES.wrongCurrent, field: "current" };
    if (check === "rate_limited") return fail("RATE_LIMITED", PASSWORD_CHANGE_MESSAGES.tooMany);
    if (check === "unavailable") return fail("INTERNAL");
    if (await isPwnedPassword(password)) return { ok: false, code: "INVALID_INPUT", message: PASSWORD_MESSAGES.pwned, field: "password" };
    const outcome = await replacePassword(user.id, password);
    if (!outcome.ok) {
      if (outcome.reason === "same_password") return { ok: false, code: "INVALID_INPUT", message: PASSWORD_CHANGE_MESSAGES.same, field: "password" };
      if (outcome.reason === "weak_password") return { ok: false, code: "INVALID_INPUT", message: PASSWORD_MESSAGES.pwned, field: "password" };
      return fail("INTERNAL");
    }
    return { ok: true, data: null };
  } catch (error) {
    return internalError("account.change_password_failed", error);
  }
}
