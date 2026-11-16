"use client";

// Settings → Account (Story 10.3, FR4): the signed-in user's name (the author
// on their markups), saved at once, and their email, changed through a
// confirmation link sent to both addresses.

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { PLAN_LABELS, type EffectivePlan } from "@/lib/plans";
import { changeEmail, updateName } from "./profile-actions";

export const EMAIL_SENT = (email: string) =>
  `We sent confirmation links to your current address and to ${email}. Open both within an hour to finish the change.`;

const INPUT =
  "h-8 min-w-0 flex-1 rounded border border-strong bg-surface-2 px-2 text-ws-md text-text focus-ring disabled:opacity-50";

export function ProfileSection({ name, email, plan }: { name: string; email: string; plan?: EffectivePlan }) {
  const router = useRouter();
  const nameId = useId();
  const emailId = useId();
  const [nameDraft, setNameDraft] = useState(name);
  const [emailDraft, setEmailDraft] = useState("");
  const [editingEmail, setEditingEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const nameChanged = nameDraft.trim() !== name.trim() && nameDraft.trim() !== "";

  const saveName = async () => {
    setBusy(true);
    setMessage(null);
    const result = await updateName({ name: nameDraft });
    setBusy(false);
    if (!result.ok) return setMessage({ kind: "error", text: result.message });
    setNameDraft(result.data.name);
    setMessage({ kind: "ok", text: "Name saved." });
    // The workspace re-reads the profile: new markups carry the new name.
    router.refresh();
  };

  const sendEmail = async () => {
    setBusy(true);
    setMessage(null);
    const result = await changeEmail({ email: emailDraft });
    setBusy(false);
    if (!result.ok) return setMessage({ kind: "error", text: result.message });
    setEditingEmail(false);
    setEmailDraft("");
    setMessage({ kind: "ok", text: EMAIL_SENT(result.data.email) });
  };

  return (
    <section aria-label="Profile" className="flex flex-col gap-2">
      <h3 className="text-ws-sm text-muted">Profile</h3>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (nameChanged && !busy) void saveName();
        }}
      >
        <label htmlFor={nameId} className="w-12 shrink-0 text-ws-sm text-muted">
          Name
        </label>
        <input
          id={nameId}
          className={INPUT}
          value={nameDraft}
          maxLength={100}
          autoComplete="name"
          onChange={(e) => setNameDraft(e.currentTarget.value)}
          disabled={busy}
        />
        <Button size="sm" variant="secondary" type="submit" disabled={!nameChanged || busy}>
          Save name
        </Button>
      </form>
      {editingEmail ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (emailDraft.trim() && !busy) void sendEmail();
          }}
        >
          <label htmlFor={emailId} className="w-12 shrink-0 text-ws-sm text-muted">
            Email
          </label>
          <input
            id={emailId}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="New email address"
            className={INPUT}
            value={emailDraft}
            maxLength={254}
            autoFocus
            onChange={(e) => setEmailDraft(e.currentTarget.value)}
            disabled={busy}
          />
          <Button size="sm" variant="secondary" type="submit" disabled={!emailDraft.trim() || busy}>
            Send links
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setEditingEmail(false)} disabled={busy}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-ws-sm text-muted">Email</span>
          <span className="min-w-0 flex-1 truncate text-ws-md" data-testid="profile-email">
            {email}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setMessage(null);
              setEditingEmail(true);
            }}
          >
            Change email…
          </Button>
        </div>
      )}
      {plan ? (
        // Shown only: the plan is set by Plan Markup, never from here (Story 10.8).
        <div className="flex items-baseline gap-2">
          <span className="w-12 shrink-0 text-ws-sm text-muted">Plan</span>
          <span className="min-w-0 flex-1 text-ws-md" data-testid="profile-plan">
            {PLAN_LABELS[plan.plan]}
            {plan.companyName ? <span className="text-muted"> (the plan of {plan.companyName})</span> : null}
          </span>
        </div>
      ) : null}
      {message ? (
        <p role={message.kind === "error" ? "alert" : "status"} className={`text-ws-sm ${message.kind === "error" ? "text-danger" : "text-muted"}`}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
