import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCsp } from "@/lib/security/csp";

type Captured = { csp: string | null; nonce: string | null; reportOnly: string | null };

const session = vi.hoisted(() => ({
  isAuthenticated: true,
  refreshCookie: false,
  seen: [] as Captured[],
}));

vi.mock("@/lib/auth/proxy-session", () => ({
  updateSession: vi.fn(async (request: NextRequest) => {
    session.seen.push({
      csp: request.headers.get("content-security-policy"),
      nonce: request.headers.get("x-nonce"),
      reportOnly: request.headers.get("content-security-policy-report-only"),
    });
    const response = NextResponse.next({ request });
    if (session.refreshCookie) response.cookies.set("sb-test-auth-token", "refreshed");
    return { response, isAuthenticated: session.isAuthenticated };
  }),
}));

const STATIC = {
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), fullscreen=(self)",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
};

function expectStaticHeaders(res: Response) {
  for (const [key, value] of Object.entries(STATIC)) expect(res.headers.get(key)).toBe(value);
}

function nonceOf(csp: string | null): string {
  const source = parseCsp(csp).get("script-src")?.find((s) => s.startsWith("'nonce-"));
  if (!source) throw new Error("no nonce in script-src");
  return source.slice("'nonce-".length, -1);
}

async function loadProxy(nodeEnv = "production") {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  return (await import("./proxy")).proxy;
}

function request(path: string, headers?: Record<string, string>) {
  return new NextRequest(`http://localhost:3020${path}`, { headers });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:56321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
  session.isAuthenticated = true;
  session.refreshCookie = false;
  session.seen = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/security/route-policy");
});

describe("proxy security headers", () => {
  it("sends a nonce CSP and the static headers on an authenticated pass-through", async () => {
    const proxy = await loadProxy();
    const res = await proxy(request("/workspace"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    const csp = res.headers.get("content-security-policy");
    expect(nonceOf(csp)).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(parseCsp(csp).get("script-src")).toContain("'strict-dynamic'");
    expectStaticHeaders(res);
  });

  it("forwards the same CSP and the nonce on the request seen by rendering", async () => {
    const proxy = await loadProxy();
    const res = await proxy(request("/workspace"));
    const csp = res.headers.get("content-security-policy");
    expect(session.seen[0].csp).toBe(csp);
    expect(session.seen[0].nonce).toBe(nonceOf(csp));
    // NextResponse.next({ request }) carries them to rendering as overrides.
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonceOf(csp));
  });

  it("overwrites client-sent CSP, report-only CSP and x-nonce headers", async () => {
    const proxy = await loadProxy();
    const res = await proxy(
      request("/sign-in", {
        "content-security-policy": "script-src 'nonce-attacker'",
        "content-security-policy-report-only": "script-src 'nonce-attacker2'",
        "x-nonce": "attacker",
      }),
    );
    const seen = session.seen[0];
    expect(seen.csp).toBe(res.headers.get("content-security-policy"));
    expect(seen.csp).not.toContain("attacker");
    expect(seen.nonce).not.toBe("attacker");
    expect(seen.nonce).toBe(nonceOf(seen.csp));
    expect(seen.reportOnly).toBeNull();
  });

  it("redirects anonymous protected requests with the CSP, static headers and refreshed cookies", async () => {
    session.isAuthenticated = false;
    session.refreshCookie = true;
    const proxy = await loadProxy();
    const res = await proxy(request("/workspace"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3020/sign-in?next=%2Fworkspace");
    expect(nonceOf(res.headers.get("content-security-policy"))).toBeTruthy();
    expectStaticHeaders(res);
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
  });

  it("keeps anonymous public paths reachable", async () => {
    session.isAuthenticated = false;
    const proxy = await loadProxy();
    for (const path of ["/", "/sign-in"]) {
      const res = await proxy(request(path));
      expect(res.status).toBe(200);
      expectStaticHeaders(res);
    }
  });

  it("generates a fresh 128-bit nonce per request", async () => {
    const proxy = await loadProxy();
    const a = nonceOf((await proxy(request("/sign-in"))).headers.get("content-security-policy"));
    const b = nonceOf((await proxy(request("/sign-in"))).headers.get("content-security-policy"));
    expect(a).not.toBe(b);
    for (const n of [a, b]) {
      expect(n).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      expect(atob(n)).toHaveLength(16);
    }
  });

  it("uses the production policy outside development", async () => {
    const proxy = await loadProxy("production");
    const csp = (await proxy(request("/sign-in"))).headers.get("content-security-policy")!;
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("ws://localhost");
    expect(parseCsp(csp).has("upgrade-insecure-requests")).toBe(true);
  });

  it("uses the dev relaxations in development", async () => {
    const proxy = await loadProxy("development");
    const csp = (await proxy(request("/sign-in"))).headers.get("content-security-policy")!;
    expect(parseCsp(csp).get("script-src")).toContain("'unsafe-eval'");
    expect(parseCsp(csp).get("connect-src")).toContain("ws://localhost:3020");
    expect(parseCsp(csp).has("upgrade-insecure-requests")).toBe(false);
  });

  it("gives a marketing path the static policy with no nonce (fail closed)", async () => {
    vi.doMock("@/lib/security/route-policy", () => ({
      MARKETING_PATHS: new Set(["/"]),
      cspModeFor: (p: string) => (p === "/" ? "static" : "nonce"),
    }));
    const proxy = await loadProxy();
    const res = await proxy(request("/", { "x-nonce": "attacker" }));
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).not.toContain("nonce-");
    expect(parseCsp(csp).get("script-src")).toEqual(["'self'"]);
    expect(session.seen[0].nonce).toBeNull();
    expect(session.seen[0].csp).toBe(csp);
    expectStaticHeaders(res);
  });
});

describe("proxy matcher (Story 3.1)", () => {
  // Next anchors each matcher source at the start and end of the pathname.
  async function matches(pathname: string): Promise<boolean> {
    vi.resetModules();
    const { config } = await import("./proxy");
    return config.matcher.some((source) => new RegExp(`^${source}$`).test(pathname));
  }

  it("skips the static pdf.js assets (they carry their own worker CSP)", async () => {
    expect(await matches("/pdfjs/6.4.299/build/pdf.worker.min.mjs")).toBe(false);
    expect(await matches("/pdfjs/6.4.299/wasm/openjpeg.wasm")).toBe(false);
    expect(await matches("/pdfjs/6.4.299/cmaps/Adobe-Japan1-UCS2.bcmap")).toBe(false);
  });

  it("still covers app routes and look-alike paths", async () => {
    expect(await matches("/workspace")).toBe(true);
    expect(await matches("/pdfjs")).toBe(true);
    expect(await matches("/pdfjsx/a.mjs")).toBe(true);
    expect(await matches("/spike/render")).toBe(true);
  });
});
