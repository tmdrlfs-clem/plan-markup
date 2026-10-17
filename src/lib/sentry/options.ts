// Sentry init options (NFR46). Pure: types only from @sentry/nextjs.
// Errors only in M1: no tracing, no Replay, no user feedback, no PII.
import type { init } from "@sentry/nextjs";
import { scrubBreadcrumb, scrubEvent } from "./scrub";

export type SentryInitOptions = NonNullable<Parameters<typeof init>[0]>;
export type SentryRuntime = "browser" | "nodejs";

type Integration = { name: string };

/** Never enabled, even if a later SDK makes one of them a default. */
export const DENIED_INTEGRATIONS: ReadonlySet<string> = new Set([
  "Replay",
  "ReplayCanvas",
  "Feedback",
  "BrowserTracing",
]);

/**
 * The SDK-side equivalent of "no default PII" (the scrubber is the second
 * line). Only the user-agent request header is collected.
 */
export const DATA_COLLECTION = Object.freeze({
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: ["user-agent"] }, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  // Source context lines can include inline RSC payloads in the browser.
  frameContextLines: 0,
}) satisfies NonNullable<SentryInitOptions["dataCollection"]>;

export type BuildSentryOptionsInput = {
  dsn: string | undefined;
  environment: string | undefined;
  runtime: SentryRuntime;
};

/** Returns null without a DSN: Sentry is then never initialised. */
export function buildSentryOptions({ dsn, environment, runtime }: BuildSentryOptionsInput): SentryInitOptions | null {
  if (!dsn) return null;
  const options: SentryInitOptions = {
    dsn,
    environment: environment ?? (process.env.NODE_ENV === "production" ? "production" : "development"),
    // @sentry 11 removed sendDefaultPii; dataCollection defaults collect
    // everything, so every category is switched off explicitly.
    dataCollection: DATA_COLLECTION,
    // No tracesSampleRate / tracesSampler: tracing stays off in M1 (errors only).
    maxBreadcrumbs: 50,
    attachStacktrace: true,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    integrations: <T extends Integration>(defaults: T[]): T[] =>
      defaults.filter((integration) => !DENIED_INTEGRATIONS.has(integration.name)),
    initialScope: { tags: { runtime } },
  };
  // Node only: local variables can hold drawing content.
  if (runtime === "nodejs") Object.assign(options, { includeLocalVariables: false });
  return options;
}
