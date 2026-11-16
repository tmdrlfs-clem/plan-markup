"use client";

import { useActionState, useRef, useState, type FormEvent } from "react";
import { CircleX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { PASSWORD_MIN, passwordProblem } from "@/features/account/sign-up-schema";
import { joinCompany, joinWithNewAccount, type InviteState } from "./invite-actions";

const IDLE: InviteState = { status: "idle" };

function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded border border-danger bg-surface-2 px-3 py-2 text-ad-sm text-danger">
      <CircleX size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/** For a signed-in user whose email is the invited one: one button. */
export function JoinForm({ token, companyName }: { token: string; companyName: string }) {
  const [state, formAction, pending] = useActionState(joinCompany, IDLE);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <FormAlert message={state.status === "error" ? state.message : null} />
      <Button type="submit" variant="primary" size="md" className="w-full" disabled={pending}>
        {pending ? "Joining…" : `Join ${companyName}`}
      </Button>
    </form>
  );
}

/** For an invited email that has no account yet: choose a password, and the account joins at once. */
export function NewAccountJoinForm({ token, email, companyName }: { token: string; email: string; companyName: string }) {
  const [state, formAction, pending] = useActionState(joinWithNewAccount, IDLE);
  const [password, setPassword] = useState("");
  const [clientError, setClientError] = useState<string | undefined>();
  const passwordRef = useRef<HTMLInputElement>(null);
  const serverError = state.status === "error" ? state.passwordError : undefined;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const problem = passwordProblem(password);
    setClientError(problem);
    if (problem) {
      event.preventDefault();
      passwordRef.current?.focus();
    }
  }

  return (
    <form action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <FormAlert message={state.status === "error" && !state.passwordError ? state.message : null} />
      {/* Shown, not editable: the account is made for the invited address. */}
      <TextField label="Email" type="email" value={email} readOnly autoComplete="username" />
      <TextField
        ref={passwordRef}
        label="Choose a password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${PASSWORD_MIN} characters.`}
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
          if (clientError) setClientError(undefined);
        }}
        error={clientError ?? serverError}
      />
      <Button type="submit" variant="primary" size="md" className="w-full" disabled={pending}>
        {pending ? "Creating your account…" : `Create account and join ${companyName}`}
      </Button>
    </form>
  );
}
