"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";

import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-store";
import { COMPANY_ROLES, ROLE_LABELS, type CompanyRole } from "@/lib/db/companies";
import { changeMemberRole, removeMember } from "./member-actions";

const noSubscription = () => () => {};

export type MemberControlsProps = {
  userId: string;
  /** Name, or the email when there is no name. */
  label: string;
  role: CompanyRole;
  isSelf: boolean;
  /** This member is the company's only admin: their role and membership cannot change. */
  onlyAdmin: boolean;
};

export const ONLY_ADMIN_NOTE = "The only admin. Make someone else an admin to change this.";

/** Story 10.7: a member's role (a select) and Remove, each applied at once. */
export function MemberControls({ userId, label, role, isSelf, onlyAdmin }: MemberControlsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmRole, setConfirmRole] = useState<CompanyRole | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const disabled = pending || !hydrated || onlyAdmin;

  function applyRole(next: CompanyRole) {
    startTransition(async () => {
      const result = await changeMemberRole({ userId, role: next });
      if (!result.ok) {
        toast({ variant: "danger", title: result.message });
      } else if (result.data.self) {
        // The admin's own session ended with the change.
        router.push("/sign-in");
        return;
      } else if (result.data.changed) {
        toast({ variant: "success", title: `${label} is now ${ROLE_LABELS[next]} and was signed out.` });
      }
      router.refresh();
    });
  }

  function applyRemove() {
    startTransition(async () => {
      const result = await removeMember({ userId });
      if (!result.ok) {
        toast({ variant: "danger", title: result.message });
      } else if (result.data.self) {
        router.push("/sign-in");
        return;
      } else {
        toast({ variant: "success", title: `${label} is removed from the company and was signed out.` });
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {onlyAdmin ? <span className="sr-only">{ONLY_ADMIN_NOTE}</span> : null}
      <select
        aria-label={`Role of ${label}`}
        value={role}
        disabled={disabled}
        title={onlyAdmin ? ONLY_ADMIN_NOTE : undefined}
        onChange={(event) => {
          const next = event.target.value as CompanyRole;
          if (next === role) return;
          // Changing one's own role ends one's own session: ask first.
          if (isSelf) setConfirmRole(next);
          else applyRole(next);
        }}
        className="h-10 w-[120px] rounded border border-strong bg-surface-2 px-3 text-ad-sm text-text focus-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        {COMPANY_ROLES.map((value) => (
          <option key={value} value={value}>
            {ROLE_LABELS[value]}
          </option>
        ))}
      </select>
      <Button
        variant="destructive"
        size="md"
        disabled={disabled}
        title={onlyAdmin ? ONLY_ADMIN_NOTE : undefined}
        aria-label={isSelf ? "Leave the company" : `Remove ${label}`}
        onClick={() => setConfirmRemove(true)}
      >
        {isSelf ? "Leave" : "Remove"}
      </Button>

      <AlertDialog
        open={confirmRole !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRole(null);
        }}
        title="Change your own role?"
        description={`You will be ${confirmRole ? ROLE_LABELS[confirmRole] : ""} instead of Admin, can no longer manage members, and are signed out now.`}
        actionLabel="Change my role"
        destructive
        onAction={() => {
          const next = confirmRole;
          setConfirmRole(null);
          if (next) applyRole(next);
        }}
      />
      <AlertDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={isSelf ? "Leave the company?" : "Remove this member?"}
        description={
          isSelf
            ? "You leave the company and are signed out now. Your own markup sets stay with you."
            : `${label} leaves the company and is signed out now. Their own markup sets stay with them, and they can go on using Plan Markup on their own.`
        }
        actionLabel={isSelf ? "Leave the company" : "Remove member"}
        destructive
        onAction={() => {
          setConfirmRemove(false);
          applyRemove();
        }}
      />
    </div>
  );
}
