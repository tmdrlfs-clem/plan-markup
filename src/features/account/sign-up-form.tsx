"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { CircleX, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { signUp, type SignUpFieldErrors, type SignUpState } from "./sign-up-actions";
import { PASSWORD_MIN, passwordProblem } from "./sign-up-schema";
import { TurnstileWidget } from "./turnstile-widget";

const initialState: SignUpState = { status: "idle" };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(value: string): string | undefined {
  const v = value.trim();
  if (v === "") return "Enter your email address.";
  if (v.length > 254 || !EMAIL_SHAPE.test(v)) return "Enter a valid email address.";
  return undefined;
}

export const SENT_HEADING = "Check your email";
export const CHECK_PENDING = "Wait for the check below to finish, then create your account.";

/** Sign-up (Story 10.1): email, password, Turnstile; then "check your email". */
export function SignUpForm({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const [state, formAction, pending] = useActionState(signUp, initialState);
  const [clientErrors, setClientErrors] = useState<SignUpFieldErrors>({});
  const [email, setEmail] = useState("");
  const [attempt, setAttempt] = useState(0);
  // Turnstile: the token arrives a moment after the page loads.
  const [checkReady, setCheckReady] = useState(false);
  const [checkPrompt, setCheckPrompt] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const serverErrors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const errors: SignUpFieldErrors = {
    email: clientErrors.email ?? serverErrors.email,
    password: clientErrors.password ?? serverErrors.password,
  };
  const formMessage = checkPrompt
    ? CHECK_PENDING
    : state.status === "error" && state.code !== "INVALID_INPUT"
      ? state.message
      : null;

  useEffect(() => {
    if (state.status !== "error") return;
    if (state.fieldErrors?.email) emailRef.current?.focus();
    else if (state.fieldErrors?.password) passwordRef.current?.focus();
  }, [state]);

  if (state.status === "sent") {
    return (
      <div className="flex w-full max-w-sm flex-col gap-6 rounded border border-border bg-surface-1 p-8 shadow-1">
        <MailCheck size={28} aria-hidden="true" className="text-accent" />
        <h1 className="text-ad-xl font-semibold">{SENT_HEADING}</h1>
        <p className="text-ad-sm" data-testid="sign-up-sent">
          If <span className="font-medium">{state.email}</span> can be used for a new account, we have sent it a
          link. Open the link to confirm your email.
        </p>
        <section className="flex flex-col gap-1">
          <h2 className="text-ad-sm font-semibold">What happens next</h2>
          <p className="text-ad-sm text-muted">
            After you confirm, the Plan Markup administrator activates your account. Until then, signing in shows
            that your account is waiting for approval.
          </p>
        </section>
        <Link href="/sign-in" className="text-ad-sm font-medium underline underline-offset-2 focus-ring">
          Back to sign in
        </Link>
      </div>
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (pending) {
      event.preventDefault();
      return;
    }
    const emailError = validateEmail(email);
    const passwordError = passwordProblem(passwordRef.current?.value ?? "");
    setClientErrors({ email: emailError, password: passwordError });
    if (emailError || passwordError) {
      event.preventDefault();
      (emailError ? emailRef : passwordRef).current?.focus();
      return;
    }
    if (turnstileSiteKey && !checkReady) {
      event.preventDefault();
      setCheckPrompt(true);
      return;
    }
    setCheckPrompt(false);
    setCheckReady(false);
    // The form data (with this widget's token) is taken during this event; a Turnstile token is
    // single-use, so the next try gets a fresh widget.
    setAttempt((n) => n + 1);
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-6 rounded border border-border bg-surface-1 p-8 shadow-1">
      <h1 className="text-ad-xl font-semibold">Create your Plan Markup account</h1>

      {formMessage ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded border border-danger bg-surface-2 px-3 py-2 text-ad-sm text-danger"
        >
          <CircleX size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{formMessage}</span>
        </div>
      ) : null}

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
          error={errors.email}
          onBlur={(e) => {
            // Leaving an empty field says nothing (submit does): an error appearing on blur would
            // shift the links below while they are being clicked.
            const value = e.currentTarget.value;
            setClientErrors((prev) => ({ ...prev, email: value.trim() === "" ? undefined : validateEmail(value) }));
          }}
        />
        <TextField
          ref={passwordRef}
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN} characters. A passphrase is easiest to remember.`}
          error={errors.password}
          onBlur={(e) => {
            const value = e.currentTarget.value;
            setClientErrors((prev) => ({ ...prev, password: value === "" ? undefined : passwordProblem(value) }));
          }}
        />
        {turnstileSiteKey ? <TurnstileWidget
            key={attempt}
            siteKey={turnstileSiteKey}
            onReady={(ready) => {
              setCheckReady(ready);
              if (ready) setCheckPrompt(false);
            }}
          /> : null}
        <Button
          type="submit"
          variant="primary"
          size="md"
          className="mt-2 w-full"
          aria-busy={pending ? true : undefined}
        >
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="text-ad-sm text-muted">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-text underline underline-offset-2 focus-ring">
          Sign in
        </Link>
      </p>
    </div>
  );
}
