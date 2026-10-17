"use client";

import { useEffect } from "react";
import { logger } from "@/lib/logger";
import { reportError } from "@/lib/sentry/report";
import { isSafeDigest, RouteErrorScreen, type RouteErrorScreenProps } from "./route-error-screen";

const EVENT = "route.error_boundary";

function digestOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("digest" in error)) return undefined;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" ? digest : undefined;
}

export type RouteErrorBoundaryProps = {
  error: unknown;
  variant?: RouteErrorScreenProps["variant"];
  as?: RouteErrorScreenProps["as"];
};

/**
 * The shared body of every error.tsx. Server errors (with a digest) were
 * already reported by onRequestError, so only client-side errors are
 * reported here. The error message is never displayed.
 */
export function RouteErrorBoundary({ error, variant, as }: RouteErrorBoundaryProps) {
  const digest = digestOf(error);

  useEffect(() => {
    if (digest !== undefined) {
      // No Error value: the logger would forward it to the reporter again.
      logger.error(EVENT, { digest: isSafeDigest(digest) ? digest : null });
      return;
    }
    // A non-Error value is never stringified (it could be drawing content).
    const reported = error instanceof Error ? error : new Error(`Non-Error value thrown (${typeof error})`);
    logger.error(EVENT, { error: reported });
    // The SDK skips an exception object it already captured via the logger reporter.
    reportError(reported, { event: EVENT });
  }, [error, digest]);

  return <RouteErrorScreen variant={variant} as={as} digest={digest} onReload={() => window.location.reload()} />;
}
