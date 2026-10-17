// Which CSP a path gets: the per-request nonce policy (app routes) or the
// static hash policy (prerendered marketing routes). Pure.

/**
 * Statically prerendered marketing paths (exact match). Empty until Story 13.1.
 * A path may only be added here together with its build-time hash manifest
 * (Story 13.1); otherwise its inline scripts would be blocked (fail closed).
 * Adding one also needs an entry in the check:dynamic-routes allowlist.
 */
export const MARKETING_PATHS: ReadonlySet<string> = new Set<string>();

export type CspMode = "nonce" | "static";

export function cspModeFor(pathname: string): CspMode {
  return MARKETING_PATHS.has(pathname) ? "static" : "nonce";
}
