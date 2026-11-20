// Link markup (Bluebeam toolbar set, founder 2026-11-21). Framework-free.
// A box on the sheet that opens a web address or an email: only http(s) and
// mailto links are kept, so a link can never run script.

export const MAX_LINK_LENGTH = 2000;
/** What the app says when an address is not a web or mail link. */
export const NOT_A_LINK = "Enter a web address (https://…) or an email address";

/** The address as it is kept (a bare "www.…" or "example.com/…" gets https://), or null when it is not a web or mail link. */
export function normalizeLink(input: string): string | null {
  const s = input.trim();
  if (s === "" || s.length > MAX_LINK_LENGTH || /\s/.test(s)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : /^[^@/]+@[^@/]+\.[^@/]+$/.test(s) ? `mailto:${s}` : `https://${s}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol === "mailto:") return url.pathname.includes("@") ? withScheme : null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.hostname.includes(".") || url.hostname === "localhost" ? url.href : null;
}

/** Whether `uri` is a link as kept (what the schema accepts). */
export function isLink(uri: string): boolean {
  return normalizeLink(uri) === uri;
}
