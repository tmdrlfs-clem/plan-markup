import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { confirmLink } from "@/features/account/confirm-actions";
import { parseLink, type LinkType } from "@/features/account/confirm-link";

export const metadata: Metadata = { title: "Confirm", robots: { index: false }, referrer: "no-referrer" };

const COPY: Record<LinkType, { heading: string; body: string; button: string }> = {
  email: {
    heading: "Confirm your email",
    body: "Confirm that this email address is yours to finish creating your Plan Markup account.",
    button: "Confirm my email",
  },
  signup: {
    heading: "Confirm your email",
    body: "Confirm that this email address is yours to finish creating your Plan Markup account.",
    button: "Confirm my email",
  },
  recovery: {
    heading: "Reset your password",
    body: "Continue to choose a new password for your Plan Markup account.",
    button: "Continue",
  },
  email_change: {
    heading: "Confirm your new email",
    body: "Confirm the change of your Plan Markup account's email address.",
    button: "Confirm the change",
  },
};

// Where the links in our emails land. Opening the link uses nothing: the token
// is used when the button is pressed (see confirm-actions.ts).
export default async function ConfirmLinkPage({ searchParams }: PageProps<"/auth/confirm">) {
  const { token_hash, type } = await searchParams;
  const link = parseLink({ token_hash, type });
  if (!link) redirect("/sign-in?link=invalid");
  const copy = COPY[link.type];
  return (
    <div className="flex w-full max-w-sm flex-col gap-6 rounded border border-border bg-surface-1 p-8 shadow-1">
      <h1 className="text-ad-xl font-semibold">{copy.heading}</h1>
      <p className="text-ad-sm">{copy.body}</p>
      <form action={confirmLink}>
        <input type="hidden" name="token_hash" value={link.tokenHash} />
        <input type="hidden" name="type" value={link.type} />
        <Button type="submit" variant="primary" size="md" className="w-full">
          {copy.button}
        </Button>
      </form>
      <p className="text-ad-sm text-muted">If you did not ask for this email, close this page. Nothing changes.</p>
    </div>
  );
}
