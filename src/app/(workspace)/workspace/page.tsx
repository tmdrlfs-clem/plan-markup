import type { Metadata } from "next";
import { WorkspaceShell } from "@/features/workspace/workspace-shell";
import { requireActiveUser } from "@/lib/auth";
import { getOwnMembership, type Membership } from "@/lib/db/companies";
import { logger } from "@/lib/logger";
import { effectivePlan } from "@/lib/plans";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Workspace" };

/**
 * Story 10.6: the user's company, for the Company item and the plan they are
 * shown. A failed read only leaves those out; the workspace still opens.
 */
async function readMembership(userId: string): Promise<Membership | null | undefined> {
  try {
    return await getOwnMembership(await createServerSupabase(), userId);
  } catch (error) {
    logger.error("workspace.membership_read_failed", { error: error instanceof Error ? error : null });
    return undefined;
  }
}

export default async function WorkspacePage() {
  // The page calls the guard itself (NFR13).
  const user = await requireActiveUser("/workspace");
  const membership = await readMembership(user.id);
  // Only what the shell shows goes to the client.
  // The profile's theme is rendered on the workspace root: no flash of another theme (Story 3.8).
  return (
    <WorkspaceShell
      user={{
        id: user.id,
        name: user.name,
        email: user.email,
        isPlatformAdmin: user.isPlatformAdmin,
        isCompanyAdmin: membership?.role === "admin",
        // Unknown membership: no plan is shown rather than a possibly wrong one.
        plan:
          membership === undefined
            ? undefined
            : effectivePlan(user.plan, membership ? { plan: membership.companyPlan, name: membership.companyName } : null),
      }}
      theme={user.theme}
    />
  );
}
