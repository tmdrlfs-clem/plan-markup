"use server";

import { getAuthUser } from "@/lib/auth";
import { fail, internalError, type Result } from "@/lib/result";
import { createServerSupabase } from "@/lib/supabase/server";
import { ThemeSchema, type Theme } from "@/lib/theme";

/**
 * Stores the signed-in user's workspace theme on their profile (Story 3.8 AC 3).
 * The user comes from the session (never from the input); the value is
 * validated here, again by the column's check constraint, and the write goes
 * through RLS (own row) and the column grant (name and theme only).
 */
export async function setTheme(input: unknown): Promise<Result<{ theme: Theme }>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  const parsed = ThemeSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "Choose Blueprint, Daylight or High contrast.");
  const theme = parsed.data;
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.from("profiles").update({ theme }).eq("id", user.id).select("theme");
    if (error) return internalError("appearance.set_theme_failed", new Error(`profiles update failed: ${error.code ?? "unknown"}`));
    // RLS hides the row (should not happen for an active user): nothing was stored.
    if (!data || data.length !== 1) return fail("NOT_FOUND");
    return { ok: true, data: { theme } };
  } catch (error) {
    return internalError("appearance.set_theme_failed", error);
  }
}
