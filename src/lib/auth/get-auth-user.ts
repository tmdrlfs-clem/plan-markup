import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getOwnProfile } from "@/lib/db/profiles";
import { createServerSupabase } from "@/lib/supabase/server";
import { sanitizeNextPath } from "./redirect";

import type { Theme } from "@/lib/theme";

export type AuthUser = { id: string; email: string; name: string; isPlatformAdmin: boolean; theme: Theme };

export type AuthState =
  | { kind: "anonymous" }
  | { kind: "inactive"; userId: string; email: string; status: "pending" | "deactivated" }
  | { kind: "active"; user: AuthUser };

/**
 * Reads the auth state from this request's cookies, uncached. Use it right
 * after sign-in, when the cached getAuthState() would still say "anonymous".
 *
 * Status and the admin flag come from public.profiles only, never from
 * user_metadata or app_metadata (NFR11, NFR12).
 */
export async function readAuthState(): Promise<AuthState> {
  const supabase = await createServerSupabase();
  // Verifies the JWT with the Auth server (also rejects signed-out sessions).
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { kind: "anonymous" };

  // Throws on a query error: fail closed, never fall back to "active".
  const profile = await getOwnProfile(supabase, data.user.id);
  if (!profile) {
    return { kind: "inactive", userId: data.user.id, email: data.user.email ?? "", status: "pending" };
  }
  if (profile.status !== "active") {
    return { kind: "inactive", userId: profile.id, email: profile.email, status: profile.status };
  }
  return {
    kind: "active",
    user: {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      isPlatformAdmin: profile.isPlatformAdmin,
      theme: profile.theme,
    },
  };
}

/** The auth state of this request, shared by its page, layout and actions (React cache). */
export const getAuthState: () => Promise<AuthState> = cache(readAuthState);

/**
 * The only way server code identifies the user (AR4, NFR11). Returns the user
 * only when their profile is active; pending, deactivated and missing profiles
 * count as not signed in to the workspace.
 *
 * Every server action and route handler calls it itself (NFR13):
 *
 * ```ts
 * const user = await getAuthUser();
 * if (!user) return { ok: false, code: "UNAUTHENTICATED", message: "Sign in to continue." };
 * ```
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  const state = await getAuthState();
  return state.kind === "active" ? state.user : null;
}

/**
 * Page guard: returns the active user, or redirects anonymous users to sign-in
 * and inactive users to /pending-activation. Every protected page calls it itself.
 */
export async function requireActiveUser(nextPath?: string): Promise<AuthUser> {
  const state = await getAuthState();
  // redirect() throws a control-flow error: keep it outside any try/catch.
  if (state.kind === "anonymous") {
    redirect(
      nextPath === undefined
        ? "/sign-in"
        : `/sign-in?next=${encodeURIComponent(sanitizeNextPath(nextPath))}`,
    );
  }
  if (state.kind === "inactive") redirect("/pending-activation");
  return state.user;
}
