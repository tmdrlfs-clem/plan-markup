// Hashes of inline <script> bodies for the static marketing CSP (Story 13.1
// runs this over the prerendered HTML in a postbuild step). Pure.

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const SRC_ATTR_RE = /(?:^|\s)src\s*=/i;

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

/**
 * Returns `'sha256-<base64>'` for every `<script>` without a `src` attribute,
 * in document order and de-duplicated. The hash covers the exact text between
 * the tags, as browsers hash it.
 */
export async function hashInlineScripts(html: string): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of html.matchAll(SCRIPT_RE)) {
    const [, attrs, body] = match;
    if (SRC_ATTR_RE.test(attrs)) continue;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const source = `'sha256-${toBase64(digest)}'`;
    if (seen.has(source)) continue;
    seen.add(source);
    out.push(source);
  }
  return out;
}
