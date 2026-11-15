"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";

import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-store";
import type { ProfileStatus } from "@/lib/db/profiles";
import { setUserStatus } from "./actions";

export type UserStatusActionProps = {
  userId: string;
  /** Name, or the email when there is no name: said in the confirmation and to screen readers. */
  label: string;
  status: ProfileStatus;
  /** The signed-in admin's own row: it cannot be deactivated. */
  isSelf: boolean;
};

const noSubscription = () => () => {};

/** False in the server render and until React has taken over the page: a click before then would do nothing. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/** The row's one action: Activate (pending, deactivated) or Deactivate (active), with a confirmation. */
export function UserStatusAction({ userId, label, status, isSelf }: UserStatusActionProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const hydrated = useHydrated();
  const busy = pending || !hydrated;

  function run(next: "active" | "deactivated") {
    startTransition(async () => {
      const result = await setUserStatus({ userId, status: next });
      if (!result.ok) {
        toast({ variant: "danger", title: result.message });
        return;
      }
      if (next === "deactivated") {
        toast({ variant: "success", title: `${label} is deactivated and signed out.` });
      } else if (result.data.mail === "sent") {
        toast({ variant: "success", title: `${label} is active. The "You're in" email is on its way.` });
      } else if (result.data.changed) {
        toast({ variant: "warning", title: `${label} is active, but the "You're in" email was not sent. Let them know yourself.` });
      } else {
        toast({ variant: "info", title: `${label} was already active.` });
      }
      router.refresh();
    });
  }

  if (status === "active") {
    if (isSelf) return <span className="text-ad-sm text-muted">You</span>;
    return (
      <AlertDialog
        open={confirming}
        onOpenChange={setConfirming}
        trigger={
          <Button variant="destructive" size="md" disabled={busy} aria-label={`Deactivate ${label}`}>
            Deactivate
          </Button>
        }
        title="Deactivate this account?"
        description={`${label} is signed out at once and can't open drawings or markups until you activate the account again. Nothing is deleted.`}
        actionLabel="Deactivate account"
        destructive
        onAction={() => {
          setConfirming(false);
          run("deactivated");
        }}
      />
    );
  }
  return (
    <Button variant="primary" size="md" disabled={busy} aria-label={`Activate ${label}`} onClick={() => run("active")}>
      {pending ? "Activating…" : "Activate"}
    </Button>
  );
}
