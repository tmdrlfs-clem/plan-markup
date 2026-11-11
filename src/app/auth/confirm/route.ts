import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { createServerSupabase } from "@/lib/supabase/server";

// Story 10.1: the link in the confirmation email. Verifying the token hash
// confirms the email and signs the user in; the profile is still `pending`, so
// they land on the PendingActivation screen. Story 10.2: a recovery link signs
// in the same way and lands on /reset-password.
// Story 10.3: an email-change link; the change completes when both addresses' links are opened.
const TYPES = new Set(["email", "signup", "recovery", "email_change"]);

function landing(type: string, newEmailPending: boolean): string {
  if (type === "recovery") return "/reset-password";
  if (type === "email_change") return newEmailPending ? "/email-change?step=other" : "/email-change?step=done";
  return "/pending-activation";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const target = request.nextUrl.clone();
  target.search = "";

  if (tokenHash && tokenHash.length <= 512 && type && TYPES.has(type)) {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "email" | "signup" | "recovery" | "email_change",
    });
    if (!error) {
      // The first of the two email-change links answers without a user (Auth's "proceed to the
      // other email"); the second returns the user with the new email.
      const to = new URL(landing(type, !data.user || Boolean(data.user.new_email)), target);
      return NextResponse.redirect(to);
    }
    logger.warn("auth.confirm_failed", { status: error.status, code: error.code });
  }
  target.pathname = "/sign-in";
  target.searchParams.set("link", "invalid");
  return NextResponse.redirect(target);
}
