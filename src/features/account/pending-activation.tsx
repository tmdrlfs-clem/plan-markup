import type { ReactNode } from "react";

export type PendingActivationProps = {
  status: "pending" | "deactivated";
  email: string;
  /** The sign-out control (a server action form). */
  signOutSlot: ReactNode;
};

const COPY = {
  pending: {
    heading: "Your account is waiting for approval",
    body: "The Plan Markup administrator activates new accounts. You can't open drawings or markups until your account is active.",
    next: "Once your account is activated, sign in again to open your workspace.",
  },
  deactivated: {
    heading: "Your account is not active",
    body: "This account has been deactivated. Contact your Plan Markup administrator if you think this is a mistake.",
    next: null,
  },
} as const;

/** PendingActivation screen (UX-DR30) for pending and deactivated accounts. */
export function PendingActivation({ status, email, signOutSlot }: PendingActivationProps) {
  const copy = COPY[status];
  return (
    <div className="flex w-full max-w-sm flex-col gap-6 rounded border border-border bg-surface-1 p-8 shadow-1">
      <h1 className="text-ad-xl font-semibold">{copy.heading}</h1>
      <p className="text-ad-sm">{copy.body}</p>
      {copy.next ? (
        <section className="flex flex-col gap-1">
          <h2 className="text-ad-sm font-semibold">What happens next</h2>
          <p className="text-ad-sm text-muted">{copy.next}</p>
        </section>
      ) : null}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <p className="text-ad-sm text-muted">
          Signed in as <span className="font-medium text-text">{email}</span>
        </p>
        {signOutSlot}
      </div>
    </div>
  );
}
