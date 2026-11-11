import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { createServerSupabase } from "@/lib/supabase/server";

// Story 10.1: the link in the confirmation email. Verifying the token hash
// confirms the email and signs the user in; the profile is still `pending`, so
// they land on the PendingActivation screen.
const TYPES = new Set(["email", "signup"]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const target = request.nextUrl.clone();
  target.search = "";

  if (tokenHash && tokenHash.length <= 512 && type && TYPES.has(type)) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as "email" | "signup" });
    if (!error) {
      target.pathname = "/pending-activation";
      return NextResponse.redirect(target);
    }
    logger.warn("auth.confirm_failed", { status: error.status, code: error.code });
  }
  target.pathname = "/sign-in";
  target.searchParams.set("link", "invalid");
  return NextResponse.redirect(target);
}
