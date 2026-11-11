import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/features/account/sign-in-form";
import { getAuthState } from "@/lib/auth";
import { sanitizeNextPath } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next, link } = await searchParams;
  const safeNext = sanitizeNextPath(Array.isArray(next) ? next[0] : next);

  const state = await getAuthState();
  if (state.kind === "active") redirect(safeNext);
  if (state.kind === "inactive") redirect("/pending-activation");

  return <SignInForm next={safeNext} linkInvalid={link === "invalid"} />;
}
