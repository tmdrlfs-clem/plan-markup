import * as Sentry from "@sentry/nextjs";

/**
 * Runs once per server instance. Sentry starts only on the Node runtime and
 * only with NEXT_PUBLIC_SENTRY_DSN (src/lib/sentry/init.ts).
 * Nothing in this app runs on the edge runtime (the proxy runs on Node in
 * Next.js 16), so there is no edge branch.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initSentry } = await import("@/lib/sentry/init");
    initSentry("nodejs");
  }
}

/** Server errors (render, route, action, proxy). A no-op without a Sentry client. */
export const onRequestError = Sentry.captureRequestError;
