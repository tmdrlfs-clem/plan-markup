"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { signIn, type SignInFieldErrors, type SignInState } from "./actions";

const initialState: SignInState = { status: "idle" };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(value: string): string | undefined {
  const v = value.trim();
  if (v === "") return "Enter your email address.";
  if (v.length > 254 || !EMAIL_SHAPE.test(v)) return "Enter a valid email address.";
  return undefined;
}

function validatePassword(value: string): string | undefined {
  return value === "" ? "Enter your password." : undefined;
}

export const LINK_INVALID_NOTICE =
  "That confirmation link has expired or was already used. Sign in if you have confirmed your email, or sign up again for a new link.";

export function SignInForm({ next, linkInvalid = false }: { next: string; linkInvalid?: boolean }) {
  const [state, formAction, pending] = useActionState(signIn, initialState);
  const [clientErrors, setClientErrors] = useState<SignInFieldErrors>({});
  // Controlled, so React's post-action form reset keeps the email (the password is cleared).
  const [email, setEmail] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const serverErrors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const errors: SignInFieldErrors = {
    email: clientErrors.email ?? serverErrors.email,
    password: clientErrors.password ?? serverErrors.password,
  };
  const formMessage =
    state.status === "error" && state.code !== "INVALID_INPUT"
      ? state.message
      : state.status === "idle" && linkInvalid
        ? LINK_INVALID_NOTICE
        : null;

  // After a failed server submit, focus the first invalid field.
  useEffect(() => {
    if (state.status !== "error") return;
    if (state.fieldErrors?.email) emailRef.current?.focus();
    else if (state.fieldErrors?.password) passwordRef.current?.focus();
  }, [state]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (pending) {
      event.preventDefault();
      return;
    }
    const emailError = validateEmail(email);
    const passwordError = validatePassword(passwordRef.current?.value ?? "");
    setClientErrors({ email: emailError, password: passwordError });
    if (emailError || passwordError) {
      event.preventDefault();
      (emailError ? emailRef : passwordRef).current?.focus();
    }
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-6 rounded border border-border bg-surface-1 p-8 shadow-1">
      <h1 className="text-ad-xl font-semibold">Sign in to Plan Markup</h1>

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
        <input type="hidden" name="next" value={next} />
        <TextField
          ref={emailRef}
          label="Email"
          name="email"
          type="email"
          autoComplete="username"
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
          autoComplete="current-password"
          error={errors.password}
          onBlur={(e) => {
            // Clears a submit error once filled; an empty field is reported on submit.
            const value = e.currentTarget.value;
            setClientErrors((prev) => ({ ...prev, password: value === "" ? undefined : validatePassword(value) }));
          }}
        />
        <Button
          type="submit"
          variant="primary"
          size="md"
          className="mt-2 w-full"
          aria-busy={pending ? true : undefined}
        >
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="text-ad-sm text-muted">
        New to Plan Markup?{" "}
        <Link href="/sign-up" className="font-medium text-text underline underline-offset-2 focus-ring">
          Create an account
        </Link>
      </p>
    </div>
  );
}
