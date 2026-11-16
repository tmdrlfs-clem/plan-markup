import type { Metadata } from "next";
import { WorkspaceShell } from "@/features/workspace/workspace-shell";
import { requireActiveUser } from "@/lib/auth";
import { getOwnMembership } from "@/lib/db/companies";
import { logger } from "@/lib/logger";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Workspace" };

/** Story 10.6: whether to show the Company item. A failed read only hides the item; the workspace still opens. */
async function isCompanyAdmin(userId: string): Promise<boolean> {
  try {
    const membership = await getOwnMembership(await createServerSupabase(), userId);
    return membership?.role === "admin";
  } catch (error) {
    logger.error("workspace.membership_read_failed", { error: error instanceof Error ? error : null });
    return false;
  }
}

export default async function WorkspacePage() {
  // The page calls the guard itself (NFR13).
  const user = await requireActiveUser("/workspace");
  // Only what the shell shows goes to the client.
  // The profile's theme is rendered on the workspace root: no flash of another theme (Story 3.8).
  return (
    <WorkspaceShell
      user={{
        id: user.id,
        name: user.name,
        email: user.email,
        isPlatformAdmin: user.isPlatformAdmin,
        isCompanyAdmin: await isCompanyAdmin(user.id),
      }}
      theme={user.theme}
    />
  );
}
