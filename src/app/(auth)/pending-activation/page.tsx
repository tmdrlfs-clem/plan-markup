import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { signOut } from "@/features/account/actions";
import { PendingActivation } from "@/features/account/pending-activation";
import { getAuthState } from "@/lib/auth";

export const metadata: Metadata = { title: "Waiting for approval" };

export default async function PendingActivationPage() {
  const state = await getAuthState();
  if (state.kind === "anonymous") redirect("/sign-in");
  if (state.kind === "active") redirect("/workspace");

  return (
    <PendingActivation
      status={state.status}
      email={state.email}
      signOutSlot={
        <form action={signOut}>
          <Button type="submit" variant="secondary" size="md" className="w-full">
            Sign out
          </Button>
        </form>
      }
    />
  );
}
