import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResetLinkNeeded, ResetPasswordForm } from "@/features/account/password-reset-forms";
import { getAuthState } from "@/lib/auth";
import { sessionCameFromRecovery } from "@/lib/auth/password-reset";

export const metadata: Metadata = { title: "Choose a new password" };

// Story 10.2: reached from the reset link (/auth/confirm signs in with it).
// Pending and deactivated users may reset too; they land on PendingActivation after.
export default async function ResetPasswordPage() {
  const state = await getAuthState();
  if (state.kind === "anonymous") redirect("/sign-in");
  if (!(await sessionCameFromRecovery())) return <ResetLinkNeeded />;
  const email = state.kind === "active" ? state.user.email : state.email;
  return <ResetPasswordForm email={email} />;
}
