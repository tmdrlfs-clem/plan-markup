"use client";

// Settings → Account (Story 10.3, FR4): the signed-in user's name (the author
// on their markups), saved at once; their email, changed through a
// confirmation link sent to both addresses; and their password, changed with
// the current one.

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { PLAN_LABELS, type EffectivePlan } from "@/lib/plans";
import { changePassword, type PasswordChangeField } from "./password-change-actions";
import { PASSWORD_CHANGE_MESSAGES } from "./password-change-messages";
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
  const currentId = useId();
  const newId = useId();
  const [editingPassword, setEditingPassword] = useState(false);
  const [current, setCurrent] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [fieldError, setFieldError] = useState<{ field: PasswordChangeField; text: string } | null>(null);

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

  const closePassword = () => {
    setEditingPassword(false);
    setCurrent("");
    setNextPassword("");
    setFieldError(null);
  };

  const savePassword = async () => {
    setBusy(true);
    setMessage(null);
    setFieldError(null);
    const result = await changePassword({ current, password: nextPassword });
    setBusy(false);
    if (!result.ok) {
      if ("field" in result) return setFieldError({ field: result.field, text: result.message });
      return setMessage({ kind: "error", text: result.message });
    }
    closePassword();
    setMessage({ kind: "ok", text: PASSWORD_CHANGE_MESSAGES.done });
  };

  const fieldErrorFor = (field: PasswordChangeField, id: string) =>
    fieldError?.field === field ? (
      <p id={id} role="alert" className="text-ws-sm text-danger">
        {fieldError.text}
      </p>
    ) : null;

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
        <label htmlFor={nameId} className="w-16 shrink-0 text-ws-sm text-muted">
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
          <label htmlFor={emailId} className="w-16 shrink-0 text-ws-sm text-muted">
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
          <span className="w-16 shrink-0 text-ws-sm text-muted">Email</span>
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
      {editingPassword ? (
        <form
          className="flex flex-col gap-2"
          aria-label="Change password"
          onSubmit={(e) => {
            e.preventDefault();
            if (current && nextPassword && !busy) void savePassword();
          }}
        >
          <div className="flex items-center gap-2">
            <label htmlFor={currentId} className="w-28 shrink-0 text-ws-sm text-muted">
              Current password
            </label>
            <input
              id={currentId}
              type="password"
              autoComplete="current-password"
              className={INPUT}
              value={current}
              maxLength={200}
              autoFocus
              aria-invalid={fieldError?.field === "current" || undefined}
              aria-describedby={fieldError?.field === "current" ? `${currentId}-error` : undefined}
              onChange={(e) => setCurrent(e.currentTarget.value)}
              disabled={busy}
            />
          </div>
          {fieldErrorFor("current", `${currentId}-error`)}
          <div className="flex items-center gap-2">
            <label htmlFor={newId} className="w-28 shrink-0 text-ws-sm text-muted">
              New password
            </label>
            <input
              id={newId}
              type="password"
              autoComplete="new-password"
              className={INPUT}
              value={nextPassword}
              maxLength={200}
              aria-invalid={fieldError?.field === "password" || undefined}
              aria-describedby={fieldError?.field === "password" ? `${newId}-error` : `${newId}-hint`}
              onChange={(e) => setNextPassword(e.currentTarget.value)}
              disabled={busy}
            />
          </div>
          {fieldErrorFor("password", `${newId}-error`) ?? (
            <p id={`${newId}-hint`} className="text-ws-sm text-muted">
              At least 12 characters. Other devices are signed out.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" type="button" onClick={closePassword} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" variant="secondary" type="submit" disabled={!current || !nextPassword || busy}>
              Change password
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-ws-sm text-muted">Password</span>
          <span className="min-w-0 flex-1 text-ws-md text-muted" aria-hidden="true">
            ••••••••••••
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setMessage(null);
              setEditingEmail(false);
              setEditingPassword(true);
            }}
          >
            Change password…
          </Button>
        </div>
      )}
      {plan ? (
        // Shown only: the plan is set by Plan Markup, never from here (Story 10.8).
        <div className="flex items-baseline gap-2">
          <span className="w-16 shrink-0 text-ws-sm text-muted">Plan</span>
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
