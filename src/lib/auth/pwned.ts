import "server-only";
import { createHash } from "node:crypto";
import { logger } from "@/lib/logger";

/** Have I Been Pwned range API (k-anonymity: only 5 hex characters of the hash leave the server). */
export const PWNED_RANGE_URL = "https://api.pwnedpasswords.com/range/";

type Fetch = typeof fetch;

/**
 * True when the password appears in a known breach (Story 10.1, NFR18).
 * Fails open: when the service cannot be reached the password is allowed and a
 * warning is logged, since the length rule still applies.
 */
export async function isPwnedPassword(password: string, fetchImpl: Fetch = fetch): Promise<boolean> {
  const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetchImpl(PWNED_RANGE_URL + prefix, {
      // Padding hides the real size of the answer.
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      logger.warn("auth.pwned_check_unavailable", { status: res.status });
      return false;
    }
    const text = await res.text();
    for (const line of text.split("\n")) {
      const [s, count] = line.trim().split(":");
      // Padding lines have a count of 0.
      if (s === suffix && Number(count) > 0) return true;
    }
    return false;
  } catch (error) {
    logger.warn("auth.pwned_check_unavailable", { error: error instanceof Error ? error : null });
    return false;
  }
}
