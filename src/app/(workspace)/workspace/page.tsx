import type { Metadata } from "next";
import { WorkspaceShell } from "@/features/workspace/workspace-shell";
import { requireActiveUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Workspace" };

export default async function WorkspacePage() {
  // The page calls the guard itself (NFR13).
  const user = await requireActiveUser("/workspace");
  // Only what the shell shows goes to the client.
  // The profile's theme is rendered on the workspace root: no flash of another theme (Story 3.8).
  return <WorkspaceShell user={{ id: user.id, name: user.name, email: user.email }} theme={user.theme} />;
}
