import { describe, expect, it } from "vitest";
import {
  buildNonceCsp,
  buildStaticCsp,
  generateNonce,
  parseCsp,
  sentryIngestOrigin,
  supabaseConnectSources,
} from "./csp";

const SUPABASE = "http://127.0.0.1:56321";
const NONCE = "AAAAAAAAAAAAAAAAAAAAAA==";
// Next.js: server/app-render/get-script-nonce-from-header.js
const NEXT_NONCE_RE = /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/;

describe("generateNonce", () => {
  it("returns 16 random bytes as base64 that Next.js accepts", () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(`'nonce-${nonce}'`).toMatch(NEXT_NONCE_RE);
    expect(atob(nonce)).toHaveLength(16);
  });

  it("returns a different nonce each call", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => generateNonce()));
    expect(nonces.size).toBe(50);
  });
});

describe("buildNonceCsp", () => {
  it("builds the exact production policy", () => {
    expect(buildNonceCsp({ nonce: NONCE, supabaseUrl: SUPABASE, sentryDsn: undefined, isDev: false })).toBe(
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`,
        `style-src 'self' 'nonce-${NONCE}'`,
        "style-src-attr 'unsafe-inline'",
        "img-src 'self' blob: data:",
        "font-src 'self'",
        "connect-src 'self' http://127.0.0.1:56321 ws://127.0.0.1:56321",
        "frame-src 'self' blob:",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests",
      ].join("; "),
    );
  });

  it("has no unsafe-eval, no unsafe-inline in script-src/style-src and no dev socket in production", () => {
    const csp = buildNonceCsp({
      nonce: NONCE,
      supabaseUrl: SUPABASE,
      sentryDsn: undefined,
      isDev: false,
      devHost: "localhost:3020",
    });
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("ws://localhost");
    const parsed = parseCsp(csp);
    expect(parsed.get("script-src")).not.toContain("'unsafe-inline'");
    expect(parsed.get("style-src")).not.toContain("'unsafe-inline'");
    expect(csp.endsWith(";")).toBe(false);
  });

  it("builds the exact development policy (the four dev relaxations only)", () => {
    expect(
      buildNonceCsp({
        nonce: NONCE,
        supabaseUrl: SUPABASE,
        sentryDsn: undefined,
        isDev: true,
        devHost: "localhost:3020",
      }),
    ).toBe(
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic' 'unsafe-eval'`,
        "style-src 'self' 'unsafe-inline'",
        "style-src-attr 'unsafe-inline'",
        "img-src 'self' blob: data:",
        "font-src 'self'",
        "connect-src 'self' http://127.0.0.1:56321 ws://127.0.0.1:56321 ws://localhost:3020",
        "frame-src 'self' blob:",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    );
  });

  it("never puts unsafe-inline in script-src, even in development", () => {
    const csp = buildNonceCsp({ nonce: NONCE, supabaseUrl: SUPABASE, sentryDsn: undefined, isDev: true });
    expect(parseCsp(csp).get("script-src")).not.toContain("'unsafe-inline'");
  });

  it("puts a nonce that Next.js extracts into script-src", () => {
    const nonce = generateNonce();
    const csp = buildNonceCsp({ nonce, supabaseUrl: SUPABASE, sentryDsn: undefined, isDev: false });
    const source = parseCsp(csp).get("script-src")!.find((s) => s.startsWith("'nonce-"))!;
    expect(source.match(NEXT_NONCE_RE)?.[1]).toBe(nonce);
  });

  it("adds the Sentry ingest origin only with a DSN", () => {
    const withDsn = buildNonceCsp({
      nonce: NONCE,
      supabaseUrl: SUPABASE,
      sentryDsn: "https://abc@o123.ingest.us.sentry.io/456",
      isDev: false,
    });
    expect(parseCsp(withDsn).get("connect-src")).toEqual([
      "'self'",
      "http://127.0.0.1:56321",
      "ws://127.0.0.1:56321",
      "https://o123.ingest.us.sentry.io",
    ]);
    expect(withDsn).not.toContain("abc@");
    const without = buildNonceCsp({ nonce: NONCE, supabaseUrl: SUPABASE, sentryDsn: undefined, isDev: false });
    expect(without).not.toContain("sentry");
  });

  it("uses wss for an https Supabase URL", () => {
    const csp = buildNonceCsp({
      nonce: NONCE,
      supabaseUrl: "https://x.supabase.co",
      sentryDsn: undefined,
      isDev: false,
    });
    expect(parseCsp(csp).get("connect-src")).toEqual(["'self'", "https://x.supabase.co", "wss://x.supabase.co"]);
  });
});

describe("buildStaticCsp", () => {
  it("uses hashes, no nonce and no strict-dynamic", () => {
    const csp = buildStaticCsp({
      scriptHashes: ["'sha256-abc='", "'sha256-def='"],
      supabaseUrl: SUPABASE,
      sentryDsn: undefined,
      isDev: false,
    });
    const parsed = parseCsp(csp);
    expect(parsed.get("script-src")).toEqual(["'self'", "'sha256-abc='", "'sha256-def='"]);
    expect(parsed.get("style-src")).toEqual(["'self'"]);
    expect(csp).not.toContain("nonce-");
    expect(csp).not.toContain("strict-dynamic");
    expect(csp).not.toContain("unsafe-eval");
    expect(parsed.get("frame-ancestors")).toEqual(["'none'"]);
    expect(parsed.get("object-src")).toEqual(["'none'"]);
    expect(parsed.get("worker-src")).toEqual(["'self'", "blob:"]);
    expect(parsed.has("upgrade-insecure-requests")).toBe(true);
  });

  it("fails closed with no hashes", () => {
    const csp = buildStaticCsp({ scriptHashes: [], supabaseUrl: SUPABASE, sentryDsn: undefined, isDev: false });
    expect(parseCsp(csp).get("script-src")).toEqual(["'self'"]);
  });
});

describe("sentryIngestOrigin", () => {
  it.each([
    ["https://abc@o123.ingest.us.sentry.io/456", "https://o123.ingest.us.sentry.io"],
    [undefined, null],
    ["", null],
    ["not a url", null],
    ["javascript:alert(1)", null],
  ])("%s → %s", (dsn, expected) => {
    expect(sentryIngestOrigin(dsn)).toBe(expected);
  });
});

describe("supabaseConnectSources", () => {
  it("returns the origin and the ws form", () => {
    expect(supabaseConnectSources("http://127.0.0.1:56321/")).toEqual([
      "http://127.0.0.1:56321",
      "ws://127.0.0.1:56321",
    ]);
  });

  it("throws on an invalid URL", () => {
    expect(() => supabaseConnectSources("nope")).toThrow();
  });
});

describe("parseCsp", () => {
  it("splits directives and sources", () => {
    const parsed = parseCsp("default-src 'self';  Script-Src 'self' 'nonce-x' ; upgrade-insecure-requests");
    expect(parsed.get("default-src")).toEqual(["'self'"]);
    expect(parsed.get("script-src")).toEqual(["'self'", "'nonce-x'"]);
    expect(parsed.get("upgrade-insecure-requests")).toEqual([]);
  });

  it("returns an empty map for a missing header", () => {
    expect(parseCsp(undefined).size).toBe(0);
  });
});
