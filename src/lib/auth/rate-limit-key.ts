import { createHash } from "node:crypto";

/**
 * SHA-256 hex of `${bucket}:${value}`. Only this hash reaches the database,
 * never the raw email or IP. Pure, so tests and e2e fixtures can import it.
 */
export function rateLimitKeyHash(bucket: string, value: string): string {
  return createHash("sha256").update(`${bucket}:${value}`).digest("hex");
}
