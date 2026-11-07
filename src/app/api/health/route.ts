// Story 8.5 (NFR38): the uptime monitor's health check. Public (no session),
// never cached, and it names nothing secret: 200 { status: "ok" } when the app
// answers and Supabase Auth is reachable, 503 { status: "degraded" } when it is
// not (so the monitor alerts on either).
import { getPublicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** How long the Supabase check may take before it counts as down. */
export const HEALTH_TIMEOUT_MS = 3_000;

export async function checkSupabase(fetcher: typeof fetch = fetch): Promise<boolean> {
  const env = getPublicEnv();
  try {
    const res = await fetcher(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(): Promise<Response> {
  const supabase = await checkSupabase();
  return Response.json(
    { status: supabase ? "ok" : "degraded", checks: { app: "ok", supabase: supabase ? "ok" : "down" } },
    { status: supabase ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
