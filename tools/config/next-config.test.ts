import { afterEach, describe, expect, it, vi } from "vitest";

const SIX = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), fullscreen=(self)",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
};

async function load() {
  vi.resetModules();
  return import("../../next.config");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config.ts", () => {
  it("sends the six static security headers on every path", async () => {
    const { nextConfig } = await load();
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    expect(Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]))).toEqual(SIX);
    expect(rules[0].headers.map((h) => h.key.toLowerCase())).not.toContain("content-security-policy");
  });

  it("removes X-Powered-By", async () => {
    const { nextConfig } = await load();
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("does not widen server action origins", async () => {
    const { nextConfig } = await load();
    expect(nextConfig.experimental?.serverActions?.allowedOrigins).toBeUndefined();
  });

  it("keeps the Tailwind turbopack rule", async () => {
    const { nextConfig } = await load();
    expect(nextConfig.turbopack?.rules?.["*.css"]).toEqual({
      loaders: ["@tailwindcss/turbopack"],
      as: "*.css",
    });
  });

  it("disables source maps, releases and telemetry without SENTRY_AUTH_TOKEN", async () => {
    vi.stubEnv("SENTRY_AUTH_TOKEN", "");
    const { sentryBuildOptions } = await load();
    expect(sentryBuildOptions.sourcemaps?.disable).toBe(true);
    expect(sentryBuildOptions.release?.create).toBe(false);
    expect(sentryBuildOptions.telemetry).toBe(false);
    expect(sentryBuildOptions.authToken).toBeFalsy();
    expect(sentryBuildOptions.widenClientFileUpload).toBe(false);
  });

  it("enables upload only with a token", async () => {
    vi.stubEnv("SENTRY_AUTH_TOKEN", "test-token-not-real");
    const { sentryBuildOptions } = await load();
    expect(sentryBuildOptions.sourcemaps?.disable).toBe(false);
    expect(sentryBuildOptions.release?.create).toBe(true);
    expect(sentryBuildOptions.telemetry).toBe(false);
  });

  it("wraps the config with withSentryConfig without dropping the headers", async () => {
    const mod = await load();
    const wrapped = mod.default as unknown;
    const resolved = typeof wrapped === "function" ? await (wrapped as (p: string, o: object) => unknown)("phase-development-server", {}) : wrapped;
    const cfg = resolved as typeof mod.nextConfig;
    expect(cfg.poweredByHeader).toBe(false);
    const rules = await cfg.headers!();
    expect(rules[0].source).toBe("/:path*");
  });
});
