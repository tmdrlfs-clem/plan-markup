import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { signOut } from "@/features/account/actions";
import { JoinForm, NewAccountJoinForm } from "@/features/company/invite-forms";
import { getAuthState } from "@/lib/auth";
import { ROLE_LABELS, type CompanyRole } from "@/lib/db/companies";
import { hashInviteToken, invitePath, parseInviteToken } from "@/lib/invite-token";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Invitation", robots: { index: false, follow: false } };

// Story 10.6: the page an emailed invitation opens. It only shows the
// invitation: nothing is used up by loading it. Public (src/proxy.ts), because
// the invited person may have no account yet.

const LINK_CLASS = "font-medium text-text underline underline-offset-2 focus-ring";

function Card({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-5 rounded border border-border bg-surface-1 p-8 shadow-1">
      <h1 className="text-ad-xl font-semibold">{heading}</h1>
      {children}
    </div>
  );
}

function Closed({ heading, body }: { heading: string; body: string }) {
  return (
    <Card heading={heading}>
      <p className="text-ad-sm">{body}</p>
      <p className="text-ad-sm">
        <Link href="/sign-in" className={LINK_CLASS}>
          Go to sign in
        </Link>
      </p>
    </Card>
  );
}

const INVALID = (
  <Closed
    heading="This invitation is not valid"
    body="The link is incomplete or was never issued. Open it again from the email, or ask your company admin for a new invitation."
  />
);

function SignOutSlot() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="secondary" size="md" className="w-full">
        Sign out
      </Button>
    </form>
  );
}

export default async function InvitePage({ searchParams }: PageProps<"/invite">) {
  const token = parseInviteToken((await searchParams).token);
  if (!token) return INVALID;

  const { data, error } = await createAdminSupabase().rpc("get_company_invitation", { p_token_hash: hashInviteToken(token) });
  if (error) throw new Error(`Could not read the invitation: ${error.code ?? "unknown"}`);
  const invitation = data?.[0];
  if (!invitation) return INVALID;

  if (invitation.state === "accepted") {
    return <Closed heading="This invitation was already used" body="Each invitation works once. If you have joined, sign in to open your workspace." />;
  }
  if (invitation.state !== "open") {
    return (
      <Closed
        heading={invitation.state === "expired" ? "This invitation has expired" : "This invitation was withdrawn"}
        body="Ask your company admin for a new invitation."
      />
    );
  }

  const company = invitation.company_name;
  const role = ROLE_LABELS[invitation.role as CompanyRole] ?? invitation.role;
  const summary = (
    <p className="text-ad-sm">
      You are invited to join <span className="font-medium">{company}</span> on Plan Markup as{" "}
      <span className="font-medium">{role}</span>. The invitation is for <span className="font-medium">{invitation.email}</span>.
    </p>
  );
  const heading = `Join ${company}`;

  const state = await getAuthState();
  if (state.kind === "anonymous") {
    if (invitation.account_exists) {
      return (
        <Card heading={heading}>
          {summary}
          <p className="text-ad-sm text-muted">This email already has a Plan Markup account. Sign in, and you can join in one step.</p>
          <Link
            href={`/sign-in?next=${encodeURIComponent(invitePath(token))}`}
            className="inline-flex h-10 items-center justify-center rounded border border-accent bg-accent px-4 text-ad-sm font-medium text-accent-fg focus-ring hover:brightness-110"
          >
            Sign in to join
          </Link>
        </Card>
      );
    }
    return (
      <Card heading={heading}>
        {summary}
        <NewAccountJoinForm token={token} email={invitation.email} companyName={company} />
      </Card>
    );
  }

  const signedInEmail = state.kind === "active" ? state.user.email : state.email;
  if (signedInEmail.trim().toLowerCase() !== invitation.email) {
    return (
      <Card heading={heading}>
        {summary}
        <p className="text-ad-sm" data-testid="invite-other-account">
          You are signed in as <span className="font-medium">{signedInEmail}</span>. Sign out, then open the link again and continue with
          the invited address.
        </p>
        <SignOutSlot />
      </Card>
    );
  }
  if (state.kind === "inactive" && state.status === "deactivated") {
    return (
      <Card heading={heading}>
        {summary}
        <p className="text-ad-sm">Your account is not active, so it can&apos;t join a company. Contact your Plan Markup administrator.</p>
        <SignOutSlot />
      </Card>
    );
  }
  return (
    <Card heading={heading}>
      {summary}
      <JoinForm token={token} companyName={company} />
    </Card>
  );
}
