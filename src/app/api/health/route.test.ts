import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ getPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" }) }));

import { GET, checkSupabase } from "./route";

describe("/api/health (Story 8.5)", () => {
  it("checks Supabase Auth's health with the anon key; down on an error or a non-2xx", async () => {
    const ok = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await checkSupabase(ok as unknown as typeof fetch)).toBe(true);
    expect(ok).toHaveBeenCalledWith("http://supabase.test/auth/v1/health", expect.objectContaining({ headers: { apikey: "anon" }, cache: "no-store" }));
    expect(await checkSupabase((async () => new Response("", { status: 503 })) as unknown as typeof fetch)).toBe(false);
    expect(await checkSupabase((async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch)).toBe(false);
  });

  it("answers 200 ok or 503 degraded, never cached, nothing secret", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    let res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok", checks: { app: "ok", supabase: "ok" } });
    spy.mockRejectedValueOnce(new Error("down"));
    res = await GET();
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).not.toContain("anon");
    expect(JSON.parse(body)).toEqual({ status: "degraded", checks: { app: "ok", supabase: "down" } });
    spy.mockRestore();
  });
});
