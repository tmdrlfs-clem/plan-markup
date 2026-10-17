// Initialises Sentry once per runtime, only with a DSN (NFR46). Without
// NEXT_PUBLIC_SENTRY_DSN nothing runs: no client, no global handlers, no network.
import * as Sentry from "@sentry/nextjs";
import { setErrorReporter } from "@/lib/logger";
import { buildSentryOptions, type SentryRuntime } from "./options";
import { reportLoggedError } from "./report";

let initialised = false;

/** Returns true when Sentry was (or already is) initialised. Idempotent. */
export function initSentry(runtime: SentryRuntime): boolean {
  if (initialised) return true;
  const options = buildSentryOptions({
    // Literal reads so Next.js inlines them in the browser bundle.
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || undefined,
    runtime,
  });
  if (!options) return false;
  Sentry.init(options);
  setErrorReporter(reportLoggedError);
  initialised = true;
  return true;
}
