// Runs before the app becomes interactive. Keep it light (Next.js warns above 16 ms).
// Without NEXT_PUBLIC_SENTRY_DSN, initSentry returns before Sentry.init.
import * as Sentry from "@sentry/nextjs";
import { initSentry } from "@/lib/sentry/init";

initSentry("browser");

/** A no-op without a Sentry client. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
