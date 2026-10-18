import type { Metadata } from "next";
import { WorkspaceShell } from "@/features/workspace/workspace-shell";
import { requireActiveUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Workspace" };

export default async function WorkspacePage() {
  // The page calls the guard itself (NFR13).
  const user = await requireActiveUser("/workspace");
  // Only what the shell shows goes to the client.
  return <WorkspaceShell user={{ id: user.id, name: user.name, email: user.email }} />;
}
