import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/features/account/password-reset-forms";
import { getPublicEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Reset your password" };

// Open to everyone, signed in or not (Story 10.2).
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm turnstileSiteKey={getPublicEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY} />;
}
