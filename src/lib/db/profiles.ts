import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_THEME, isTheme, type Theme } from "@/lib/theme";
import type { Database } from "./types.gen";

export type ProfileStatus = "pending" | "active" | "deactivated";

export type Profile = {
  id: string;
  name: string;
  email: string;
  status: ProfileStatus;
  isPlatformAdmin: boolean;
  /** The workspace theme (Story 3.8); the default for a value the app does not know. */
  theme: Theme;
};

const STATUSES: readonly ProfileStatus[] = ["pending", "active", "deactivated"];

/**
 * Reads the caller's own profile through RLS (profiles_select_self).
 * Returns null when no row is visible. Throws on a query error (fail closed).
 */
export async function getOwnProfile(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<Profile | null> {
  const { data, error } = await client
    .from("profiles")
    // "*" rather than naming theme (Story 3.8 review T2): a database without the
    // column (code deployed before its migration) still answers, and the theme
    // falls back to the default instead of failing every sign-in closed.
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the profile: ${error.code ?? "unknown"}`);
  if (!data) return null;
  if (!STATUSES.includes(data.status as ProfileStatus)) {
    throw new Error("Profile has an unknown status");
  }
  return {
    id: data.id,
    name: data.name,
    email: data.email,
    status: data.status as ProfileStatus,
    isPlatformAdmin: data.is_platform_admin,
    theme: isTheme((data as { theme?: unknown }).theme) ? (data as { theme: Theme }).theme : DEFAULT_THEME,
  };
}
