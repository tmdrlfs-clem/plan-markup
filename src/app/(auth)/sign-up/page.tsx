import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/features/account/sign-up-form";
import { getAuthState } from "@/lib/auth";
import { getPublicEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage() {
  const state = await getAuthState();
  if (state.kind === "active") redirect("/workspace");
  if (state.kind === "inactive") redirect("/pending-activation");

  return <SignUpForm turnstileSiteKey={getPublicEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY} />;
}
