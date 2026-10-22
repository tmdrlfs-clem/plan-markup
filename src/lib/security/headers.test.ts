import { describe, expect, it } from "vitest";
import { applyStaticSecurityHeaders, STATIC_SECURITY_HEADERS } from "./headers";

const EXPECTED = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), fullscreen=(self)",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
};

describe("STATIC_SECURITY_HEADERS", () => {
  it("holds exactly the six headers with their values", () => {
    expect(Object.fromEntries(STATIC_SECURITY_HEADERS.map((h) => [h.key, h.value]))).toEqual(EXPECTED);
    expect(STATIC_SECURITY_HEADERS).toHaveLength(6);
  });

  it("has no HSTS preload and no CSP", () => {
    const keys = STATIC_SECURITY_HEADERS.map((h) => h.key.toLowerCase());
    expect(keys).not.toContain("content-security-policy");
    expect(EXPECTED["Strict-Transport-Security"]).not.toContain("preload");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(STATIC_SECURITY_HEADERS)).toBe(true);
  });
});

describe("applyStaticSecurityHeaders", () => {
  it("sets every header and overwrites existing values", () => {
    const headers = new Headers({ "x-frame-options": "SAMEORIGIN" });
    applyStaticSecurityHeaders(headers);
    for (const [key, value] of Object.entries(EXPECTED)) expect(headers.get(key)).toBe(value);
  });
});

describe("PDFJS_ASSET_HEADERS (Story 3.1, ADR 0005)", () => {
  it("gives the pdf.js parser worker a narrow CSP with wasm but no JS eval", async () => {
    const { PDFJS_ASSET_HEADERS, PDFJS_WORKER_CSP } = await import("./headers");
    const { parseCsp } = await import("./csp");
    const csp = parseCsp(PDFJS_WORKER_CSP);
    expect(csp.get("default-src")).toEqual(["'none'"]);
    expect(csp.get("script-src")).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(csp.get("connect-src")).toEqual(["'self'"]);
    expect(csp.get("worker-src")).toEqual(["'none'"]);
    expect(PDFJS_WORKER_CSP).not.toContain("'unsafe-eval'");
    expect(PDFJS_WORKER_CSP).not.toContain("'unsafe-inline'");
    expect(Object.fromEntries(PDFJS_ASSET_HEADERS.map((h) => [h.key, h.value]))).toEqual({
      "Content-Security-Policy": PDFJS_WORKER_CSP,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    expect(Object.isFrozen(PDFJS_ASSET_HEADERS)).toBe(true);
  });
});
