"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast-store";
import { COMPANY_ROLES, ROLE_LABELS } from "@/lib/db/companies";
import { inviteMember, revokeInvitation } from "./actions";

const noSubscription = () => () => {};

/** False in the server render and until React has taken over the page. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

const ROLE_HINTS = {
  admin: "Admins invite people and manage roles.",
  member: "Members create and edit markups.",
  viewer: "Viewers look and comment, but do not draw.",
} as const;

/** Story 10.6: invite one person by email, with a role. */
export function InviteForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const roleId = useId();
  const [pending, startTransition] = useTransition();
  const [emailError, setEmailError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [role, setRole] = useState<(typeof COMPANY_ROLES)[number]>("member");
  const hydrated = useHydrated();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    setEmailError(undefined);
    setFormError(null);
    startTransition(async () => {
      const result = await inviteMember({ email, role });
      if (!result.ok) {
        if (result.field === "email") {
          setEmailError(result.message);
          formRef.current?.querySelector<HTMLInputElement>('[name="email"]')?.focus();
        } else {
          setFormError(result.message);
        }
        router.refresh();
        return;
      }
      formRef.current?.reset();
      setRole("member");
      toast({ variant: "success", title: `Invitation sent to ${result.data.email}.` });
      router.refresh();
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      aria-labelledby="invite-heading"
      className="flex flex-col gap-4 rounded border border-border bg-surface-2 p-5 shadow-1"
    >
      <div className="flex flex-col gap-1">
        <h2 id="invite-heading" className="text-ad-md font-semibold">
          Invite someone
        </h2>
        <p className="text-ad-sm text-muted">
          They get an email with a link that works once, for that address only, and expires in 7 days.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <TextField label="Email" name="email" type="email" maxLength={254} autoComplete="off" error={emailError} readOnly={pending} />
        <div className="flex flex-col gap-1">
          <label htmlFor={roleId} className="text-ad-sm font-medium text-text">
            Role
          </label>
          <select
            id={roleId}
            name="role"
            value={role}
            onChange={(event) => setRole(event.target.value as (typeof COMPANY_ROLES)[number])}
            aria-describedby={`${roleId}-hint`}
            className="h-10 w-full rounded border border-strong bg-surface-2 px-3 text-ad-sm text-text focus-ring"
          >
            {COMPANY_ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p id={`${roleId}-hint`} className="text-ad-sm text-muted">
        {ROLE_HINTS[role]}
      </p>
      {formError ? (
        <p role="alert" className="text-ad-sm font-medium text-danger">
          {formError}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" size="md" disabled={pending || !hydrated}>
          {pending ? "Sending…" : "Send invitation"}
        </Button>
      </div>
    </form>
  );
}

/** Withdraws an open invitation: its link stops working. */
export function RevokeInvitationButton({ invitationId, email }: { invitationId: string; email: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  return (
    <Button
      variant="secondary"
      size="md"
      disabled={pending || !hydrated}
      aria-label={`Withdraw the invitation to ${email}`}
      onClick={() =>
        startTransition(async () => {
          const result = await revokeInvitation({ invitationId });
          toast(
            result.ok
              ? { variant: "success", title: `The invitation to ${email} is withdrawn.` }
              : { variant: "danger", title: result.message },
          );
          router.refresh();
        })
      }
    >
      Withdraw
    </Button>
  );
}
