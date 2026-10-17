// Result shape for server actions, RPC wrappers and worker replies (architecture AR16).
import { logger } from "./logger";

export type ResultCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "INVALID_INPUT"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "UNAUTHENTICATED";

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: ResultCode; message: string };

/**
 * Fixed user-facing copy per code (NFR32). A Result never carries an error
 * message, stack, SQL or digest: callers that need more specific copy pass a
 * constant string, never text derived from an error.
 */
export const SAFE_MESSAGES: Readonly<Record<ResultCode, string>> = Object.freeze({
  NOT_FOUND: "This item no longer exists.",
  FORBIDDEN: "You don't have access to this.",
  CONFLICT: "This changed somewhere else. Reload to see the latest version.",
  INVALID_INPUT: "Check the highlighted fields.",
  RATE_LIMITED: "Too many requests. Try again in a few minutes.",
  INTERNAL: "Something went wrong on our side. Try again shortly.",
  UNAUTHENTICATED: "Sign in to continue.",
});

/** A failed Result with the safe message for `code` (or a constant override). */
export function fail(code: ResultCode, message: string = SAFE_MESSAGES[code]): Result<never> {
  return { ok: false, code, message };
}

/**
 * Logs `error` (redacted, and reported when an error reporter is registered)
 * under the constant `event` and returns the generic INTERNAL result.
 */
export function internalError(event: string, error: unknown): Result<never> {
  // A non-Error value is never stringified (it could be user content).
  const reported = error instanceof Error ? error : new Error(`Non-Error value thrown (${typeof error})`);
  logger.error(event, { error: reported });
  return { ok: false, code: "INTERNAL", message: SAFE_MESSAGES.INTERNAL };
}
