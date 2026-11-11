import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Email change" };

const COPY = {
  other: {
    heading: "One more link to open",
    body: "This address is confirmed. Open the link we sent to your other address too; your email changes once both are confirmed.",
  },
  done: {
    heading: "Your email has changed",
    body: "Sign in with your new email from now on.",
  },
} as const;

// Story 10.3: where an email-change link lands (/auth/confirm). Public: the
// link may be opened in a browser that is not signed in.
export default async function EmailChangePage({ searchParams }: PageProps<"/email-change">) {
  const { step } = await searchParams;
  const copy = step === "done" ? COPY.done : COPY.other;
  return (
    <div className="flex w-full max-w-sm flex-col gap-6 rounded border border-border bg-surface-1 p-8 shadow-1">
      <h1 className="text-ad-xl font-semibold">{copy.heading}</h1>
      <p className="text-ad-sm">{copy.body}</p>
      <Link href="/workspace" className="text-ad-sm font-medium underline underline-offset-2 focus-ring">
        Go to Plan Markup
      </Link>
    </div>
  );
}
