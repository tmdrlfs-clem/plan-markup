"use client";

import Link from "next/link";
import { useActionState, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CircleX, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { requestReset, resetPassword, type ForgotState, type ResetState } from "./password-reset-actions";
import { PASSWORD_MIN, passwordProblem } from "./sign-up-schema";
import { CHECK_PENDING, useTurnstileGate } from "./turnstile-widget";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(value: string): string | undefined {
  const v = value.trim();
  if (v === "") return "Enter your email address.";
  if (v.length > 254 || !EMAIL_SHAPE.test(v)) return "Enter a valid email address.";
  return undefined;
}

export const RESET_SENT_HEADING = "Check your email";

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-6 rounded border border-border bg-surface-1 p-8 shadow-1">
      {children}
    </div>
  );
}

function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded border border-danger bg-surface-2 px-3 py-2 text-ad-sm text-danger"
    >
      <CircleX size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

const LINK_CLASS = "font-medium text-text underline underline-offset-2 focus-ring";

/** "Forgot password" (Story 10.2): email and Turnstile, then "check your email". */
export function ForgotPasswordForm({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const [state, formAction, pending] = useActionState(requestReset, { status: "idle" } as ForgotState);
  const [email, setEmail] = useState("");
  const [clientError, setClientError] = useState<string | undefined>();
  const emailRef = useRef<HTMLInputElement>(null);
  const check = useTurnstileGate(turnstileSiteKey);

  if (state.status === "sent") {
    return (
      <Card>
        <MailCheck size={28} aria-hidden="true" className="text-accent" />
        <h1 className="text-ad-xl font-semibold">{RESET_SENT_HEADING}</h1>
        <p className="text-ad-sm" data-testid="reset-sent">
          If <span className="font-medium">{state.email}</span> belongs to a Plan Markup account, we have sent it a
          link to choose a new password. The link works once, for one hour.
        </p>
        <Link href="/sign-in" className={`text-ad-sm ${LINK_CLASS}`}>
          Back to sign in
        </Link>
      </Card>
    );
  }

  const fieldError = clientError ?? (state.status === "error" ? state.fieldErrors?.email : undefined);
  const message = check.prompt
    ? CHECK_PENDING
    : state.status === "error" && state.code !== "INVALID_INPUT"
      ? state.message
      : null;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (pending) {
      event.preventDefault();
      return;
    }
    const error = validateEmail(email);
    setClientError(error);
    if (error) {
      event.preventDefault();
      emailRef.current?.focus();
      return;
    }
    check.pass(event);
  }

  return (
    <Card>
      <h1 className="text-ad-xl font-semibold">Reset your password</h1>
      <p className="text-ad-sm text-muted">Enter your account&apos;s email and we&apos;ll send you a link to choose a new password.</p>
      <FormAlert message={message} />
      <form action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          ref={emailRef}
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          error={fieldError}
        />
        {check.widget}
        <Button type="submit" variant="primary" size="md" className="mt-2 w-full" aria-busy={pending ? true : undefined}>
          {pending ? "Sending…" : "Send reset link"}
        </Button>
      </form>
      <p className="text-ad-sm text-muted">
        Remembered it?{" "}
        <Link href="/sign-in" className={LINK_CLASS}>
          Sign in
        </Link>
      </p>
    </Card>
  );
}

/** New password from a reset link's session (Story 10.2). */
export function ResetPasswordForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(resetPassword, { status: "idle" } as ResetState);
  const [clientError, setClientError] = useState<string | undefined>();
  const passwordRef = useRef<HTMLInputElement>(null);
  const fieldError = clientError ?? (state.status === "error" ? state.fieldErrors?.password : undefined);
  const message = state.status === "error" && state.code !== "INVALID_INPUT" ? state.message : null;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (pending) {
      event.preventDefault();
      return;
    }
    const error = passwordProblem(passwordRef.current?.value ?? "");
    setClientError(error);
    if (error) {
      event.preventDefault();
      passwordRef.current?.focus();
    }
  }

  return (
    <Card>
      <h1 className="text-ad-xl font-semibold">Choose a new password</h1>
      <p className="text-ad-sm text-muted">
        For <span className="font-medium text-text">{email}</span>. Setting it signs you out on every other device.
      </p>
      <FormAlert message={message} />
      <form action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
        <TextField
          ref={passwordRef}
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          autoFocus
          hint={`At least ${PASSWORD_MIN} characters.`}
          error={fieldError}
          onBlur={(e) => {
            const v = e.currentTarget.value;
            setClientError(v === "" ? undefined : passwordProblem(v));
          }}
        />
        <Button type="submit" variant="primary" size="md" className="mt-2 w-full" aria-busy={pending ? true : undefined}>
          {pending ? "Saving…" : "Set new password"}
        </Button>
      </form>
    </Card>
  );
}

/** /reset-password opened without a fresh reset link. */
export function ResetLinkNeeded() {
  return (
    <Card>
      <h1 className="text-ad-xl font-semibold">Open the link from your email</h1>
      <p className="text-ad-sm">
        A new password is set from the reset link we email you. Links work once, for one hour.
      </p>
      <Link href="/forgot-password" className={`text-ad-sm ${LINK_CLASS}`}>
        Send me a new link
      </Link>
    </Card>
  );
}
