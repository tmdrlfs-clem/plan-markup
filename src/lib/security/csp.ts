// Content-Security-Policy builders (NFR28). Pure: the proxy, tests and e2e import it.
// Directive order and values: Story 1.6 Dev Notes → CSP policy.

export type NonceCspInput = {
  nonce: string;
  supabaseUrl: string;
  sentryDsn: string | undefined;
  /** process.env.NODE_ENV === "development". Pass explicitly in tests. */
  isDev: boolean;
  /** request.nextUrl.host, used only in dev for the HMR socket. */
  devHost?: string;
};

export type StaticCspInput = {
  /** 'sha256-…' sources from hashInlineScripts(). */
  scriptHashes: readonly string[];
  supabaseUrl: string;
  sentryDsn: string | undefined;
  isDev: boolean;
};

type Directive = readonly [name: string, sources: readonly string[]];

/** 128-bit random nonce, base64. Matches Next's CSP_NONCE_SOURCE_REGEX. Never log it. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** The Sentry ingest origin of a DSN (drops the public key in the userinfo), or null. */
export function sentryIngestOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The Supabase origin plus its WebSocket form (Realtime). Throws on an invalid URL. */
export function supabaseConnectSources(url: string): string[] {
  const parsed = new URL(url);
  const ws = parsed.protocol === "https:" ? "wss:" : "ws:";
  return [parsed.origin, `${ws}//${parsed.host}`];
}

function connectSources(supabaseUrl: string, sentryDsn: string | undefined): string[] {
  const sources = ["'self'", ...supabaseConnectSources(supabaseUrl)];
  const sentry = sentryIngestOrigin(sentryDsn);
  if (sentry) sources.push(sentry);
  return sources;
}

function serialise(directives: readonly Directive[]): string {
  return directives
    .map(([name, sources]) => (sources.length > 0 ? `${name} ${sources.join(" ")}` : name))
    .join("; ");
}

/** The shared tail after script-src/style-src/connect-src. */
function commonTail(isDev: boolean): Directive[] {
  const tail: Directive[] = [
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  // Production only: on http://localhost it would upgrade the local Supabase calls.
  if (!isDev) tail.push(["upgrade-insecure-requests", []]);
  return tail;
}

/**
 * The per-request policy for app routes. Dev relaxations (and only these):
 * 'unsafe-eval' in script-src (React dev error stacks), style-src
 * 'self' 'unsafe-inline' without the nonce (HMR <style> tags), ws://<devHost>
 * in connect-src (HMR socket), and no upgrade-insecure-requests.
 * 'unsafe-inline' never appears in script-src.
 */
export function buildNonceCsp({ nonce, supabaseUrl, sentryDsn, isDev, devHost }: NonceCspInput): string {
  const nonceSource = `'nonce-${nonce}'`;
  const scriptSrc = ["'self'", nonceSource, "'strict-dynamic'"];
  if (isDev) scriptSrc.push("'unsafe-eval'");
  const styleSrc = isDev ? ["'self'", "'unsafe-inline'"] : ["'self'", nonceSource];
  const connectSrc = connectSources(supabaseUrl, sentryDsn);
  if (isDev && devHost) connectSrc.push(`ws://${devHost}`);
  return serialise([
    ["default-src", ["'self'"]],
    ["script-src", scriptSrc],
    ["style-src", styleSrc],
    // Style attributes only (React SSR, Radix). Accepted risk, founder decision 6.
    ["style-src-attr", ["'unsafe-inline'"]],
    ["img-src", ["'self'", "blob:", "data:"]],
    ["font-src", ["'self'"]],
    ["connect-src", connectSrc],
    // Story 8.3: the print PDF is shown in a hidden blob: frame (Chrome's PDF viewer prints it).
    ["frame-src", ["'self'", "blob:"]],
    ...commonTail(isDev),
  ]);
}

/**
 * The hash-based policy for statically prerendered marketing routes (no nonce,
 * no 'strict-dynamic'). Wired by Story 13.1 with a build-time hash manifest;
 * an empty hash list fails closed (no inline script runs).
 */
export function buildStaticCsp({ scriptHashes, supabaseUrl, sentryDsn, isDev }: StaticCspInput): string {
  const scriptSrc = ["'self'", ...scriptHashes];
  if (isDev) scriptSrc.push("'unsafe-eval'");
  return serialise([
    ["default-src", ["'self'"]],
    ["script-src", scriptSrc],
    ["style-src", isDev ? ["'self'", "'unsafe-inline'"] : ["'self'"]],
    ["style-src-attr", ["'unsafe-inline'"]],
    ["img-src", ["'self'", "blob:", "data:"]],
    ["font-src", ["'self'"]],
    ["connect-src", connectSources(supabaseUrl, sentryDsn)],
    ...commonTail(isDev),
  ]);
}

/** Parses a CSP header into directive → sources (lower-cased names). For tests and e2e. */
export function parseCsp(header: string | null | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const [name, ...sources] = tokens;
    const key = name.toLowerCase();
    if (!out.has(key)) out.set(key, sources);
  }
  return out;
}
