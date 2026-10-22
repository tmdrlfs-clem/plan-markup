import type { NextConfig } from "next";
// @sentry/nextjs 11 exports the build wrapper from the /config entry only.
import { withSentryConfig, type SentryBuildOptions } from "@sentry/nextjs/config";
// Relative import: next.config.ts cannot rely on the @/ alias.
import { PDFJS_ASSET_HEADERS, PDFJS_ASSET_PATH, STATIC_SECURITY_HEADERS } from "./src/lib/security/headers";

export const nextConfig: NextConfig = {
  poweredByHeader: false,
  // cacheComponents / partialPrefetching from the scaffold defaults are off:
  // cookie-based Supabase auth (Story 1.5) reads request data in layouts, and the
  // workspace is client-heavy. Revisit for the static marketing site (Epic 13).
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Static security headers for every path, including _next/static and anything
  // outside the proxy matcher. The CSP is per request and lives in src/proxy.ts.
  // The pdf.js assets (public/pdfjs/<version>/, outside the proxy matcher) add the
  // narrow parser-worker CSP and a long cache; see PDFJS_WORKER_CSP and ADR 0005.
  async headers() {
    return [
      { source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] },
      { source: `${PDFJS_ASSET_PATH}/:path*`, headers: [...PDFJS_ASSET_HEADERS] },
    ];
  },
  // Never trace the founder's private drawings into a server bundle.
  outputFileTracingExcludes: {
    "/**": ["./fixtures/private/**/*"],
  },
  // Server actions: Next.js compares Origin with Host / X-Forwarded-Host and rejects
  // mismatches. Same-origin only, so serverActions.allowedOrigins stays unset. Add the
  // public host here (and to EXTRA_ALLOWED_HOSTS in src/lib/http/origin.ts) only if a
  // reverse proxy ever forwards a different host.
};

const hasAuthToken = Boolean(process.env.SENTRY_AUTH_TOKEN);

/** Without SENTRY_AUTH_TOKEN the build neither fails nor uploads anything. */
export const sentryBuildOptions: SentryBuildOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: { disable: !hasAuthToken },
  release: { create: hasAuthToken },
  widenClientFileUpload: false,
};

export default withSentryConfig(nextConfig, sentryBuildOptions);
