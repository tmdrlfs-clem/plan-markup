import type { Metadata } from "next";
import { UserMenu } from "@/features/account/user-menu";
import { requireActiveUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Workspace" };

// Placeholder until Story 1.8 replaces the body with the workspace shell.
export default async function WorkspacePage() {
  // The page calls the guard itself (NFR13).
  const user = await requireActiveUser("/workspace");
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border bg-surface-1 px-4 py-2">
        <span className="text-ws-lg font-semibold">Plan Markup</span>
        <UserMenu user={user} />
      </header>
      <main className="flex flex-1 flex-col gap-2 p-8">
        <h1 className="text-ad-xl font-semibold">Workspace</h1>
        <p className="text-ad-sm text-muted">Your drawings will appear here.</p>
      </main>
    </div>
  );
}
