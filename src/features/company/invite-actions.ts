"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readAuthState } from "@/lib/auth";
import { getClientIp } from "@/lib/auth/client-ip";
import { isPwnedPassword } from "@/lib/auth/pwned";
import { checkSignUpRateLimit, type RateLimitDecision } from "@/lib/auth/rate-limit";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { hashInviteToken, parseInviteToken } from "@/lib/invite-token";
import { logger } from "@/lib/logger";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { PASSWORD_MESSAGES, passwordProblem } from "@/features/account/sign-up-schema";

// Story 10.6: what the emailed invitation link does. /invite only shows the
// invitation (mail scanners open links with GET); the token is used here, on a
// button's POST, as with the other emailed links.
//
// The link is single-use, expires after 7 days and is bound to the invited
// email (NFR18): the database function refuses any other account. Holding the
// link proves the address, so an account made through it needs no second
// confirmation email and is active as soon as it joins (FR6).

export type InviteState = { status: "idle" } | { status: "error"; message: string; passwordError?: string };

const MESSAGES = {
  invalid: "This invitation is no longer valid. Ask your company admin for a new one.",
  otherEmail: "This invitation is for another email address. Sign out, then sign in with the invited address.",
  deactivated: "Your account is not active, so it can't join a company. Contact your Plan Markup administrator.",
  member: "You are already a member of this company.",
  otherCompany: "You already belong to another company. You must leave it before you can join this one.",
  exists: "This email already has an account. Sign in to join.",
  unavailable: "Joining is unavailable right now. Try again shortly.",
  signedOut: "Sign in to join.",
} as const;

function acceptError(code: string | undefined): string {
  switch (code) {
    case "PT404":
    case "PT410":
      return MESSAGES.invalid;
    case "PT403":
      return MESSAGES.otherEmail;
    case "PT422":
      return MESSAGES.deactivated;
    case "PT409":
      return MESSAGES.member;
    case "PT423":
      return MESSAGES.otherCompany;
    default:
      return MESSAGES.unavailable;
  }
}

/** Joins as `userId`. Returns the message of a refusal, or null when the user is now a member. */
async function accept(tokenHash: string, userId: string): Promise<string | null> {
  const { error } = await createAdminSupabase().rpc("accept_company_invitation", { p_token_hash: tokenHash, p_user_id: userId });
  if (!error) return null;
  if (!error.code?.startsWith("PT")) logger.error("company.accept_invitation_failed", { code: error.code });
  return acceptError(error.code);
}

/** The signed-in user (active or still pending) accepts the invitation. */
export async function joinCompany(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const token = parseInviteToken(formData.get("token"));
  if (!token) return { status: "error", message: MESSAGES.invalid };
  // Uncached, and pending accounts count: accepting is what activates them.
  const state = await readAuthState();
  if (state.kind === "anonymous") return { status: "error", message: MESSAGES.signedOut };
  const userId = state.kind === "active" ? state.user.id : state.userId;

  let refusal: string | null;
  try {
    refusal = await accept(hashInviteToken(token), userId);
  } catch (error) {
    logger.error("company.accept_invitation_failed", { error: error instanceof Error ? error : null });
    return { status: "error", message: MESSAGES.unavailable };
  }
  if (refusal) return { status: "error", message: refusal };
  // redirect() throws a control-flow error: outside any try/catch.
  redirect("/workspace");
}

/** Someone without an account sets a password, gets an account for the invited email and joins. */
export async function joinWithNewAccount(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const token = parseInviteToken(formData.get("token"));
  if (!token) return { status: "error", message: MESSAGES.invalid };
  const rawPassword = formData.get("password");
  const password = typeof rawPassword === "string" ? rawPassword : "";
  const problem = passwordProblem(password);
  if (problem) return { status: "error", message: "Check the password.", passwordError: problem };

  const admin = createAdminSupabase();
  const tokenHash = hashInviteToken(token);
  let email: string;
  try {
    // The email comes from the invitation, never from the form.
    const { data, error } = await admin.rpc("get_company_invitation", { p_token_hash: tokenHash });
    if (error) throw new Error(`get_company_invitation failed: ${error.code ?? "unknown"}`);
    const invitation = data?.[0];
    if (!invitation || invitation.state !== "open") return { status: "error", message: MESSAGES.invalid };
    if (invitation.account_exists) return { status: "error", message: MESSAGES.exists };
    email = invitation.email;

    // The same limits as sign-up. Fails closed.
    const decision: RateLimitDecision = await checkSignUpRateLimit({ ip: getClientIp(await headers()), email });
    if (!decision.allowed) return { status: "error", message: "Too many attempts. Try again in a few minutes." };

    // Leaked-password check (fails open, as on sign-up).
    if (await isPwnedPassword(password)) {
      return { status: "error", message: "Check the password.", passwordError: PASSWORD_MESSAGES.pwned };
    }

    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) {
      const code = created.error?.code;
      if (code === "email_exists" || code === "user_already_exists") return { status: "error", message: MESSAGES.exists };
      if (code === "weak_password") return { status: "error", message: "Check the password.", passwordError: PASSWORD_MESSAGES.short };
      logger.error("company.invite_sign_up_failed", { status: created.error?.status, code });
      return { status: "error", message: MESSAGES.unavailable };
    }

    const refusal = await accept(tokenHash, created.data.user.id);
    if (refusal) return { status: "error", message: refusal };
  } catch (error) {
    logger.error("company.invite_sign_up_failed", { error: error instanceof Error ? error : null });
    return { status: "error", message: MESSAGES.unavailable };
  }

  const signedIn = await signInWithPassword(email, password);
  // The account exists and is a member; if the session could not be opened, signing in finishes the job.
  redirect(signedIn.ok ? "/workspace" : "/sign-in");
}
