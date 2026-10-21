// Gate for the throwaway performance-spike routes under /spike (Story 2.3).
// Reachable only in `next dev`, or in a local production build started with
// PLAN_MARKUP_LOCAL_SPIKE=1 (for measuring minified React) and requested on a
// loopback host. Unset in every deployed environment, so production 404s them
// (and the proxy keeps requiring a session on /spike like any other path).

export const SPIKE_PATH_PREFIX = "/spike";
export const SPIKE_FLAG = "PLAN_MARKUP_LOCAL_SPIKE";

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isSpikePath(pathname: string): boolean {
  return pathname === SPIKE_PATH_PREFIX || pathname.startsWith(`${SPIKE_PATH_PREFIX}/`);
}

/** The hostname of a Host header value (port dropped, lower-cased), or "". */
export function hostnameOf(host: string | null | undefined): string {
  if (!host) return "";
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0];
}

export type SpikeGateInput = { nodeEnv: string | undefined; flag: string | undefined; host: string | null | undefined };

/** Pure decision: development always; otherwise only flag "1" on a loopback host. */
export function spikeAllowed({ nodeEnv, flag, host }: SpikeGateInput): boolean {
  if (nodeEnv === "development") return true;
  return flag === "1" && LOOPBACK_HOSTS.has(hostnameOf(host));
}

/** spikeAllowed() for the current process environment and a request's Host header. */
export function spikeAllowedFor(host: string | null | undefined): boolean {
  return spikeAllowed({ nodeEnv: process.env.NODE_ENV, flag: process.env.PLAN_MARKUP_LOCAL_SPIKE, host });
}
