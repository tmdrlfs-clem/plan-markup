import { createHash, randomBytes } from "node:crypto";

// Story 10.6: the secret in an emailed invitation link. 32 random bytes,
// base64url (43 characters). Only its SHA-256 is stored, so a copy of the
// database cannot accept an invitation. Pure, so e2e fixtures can import it.

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

/** The token of an /invite link, or null when the value cannot be one. */
export function parseInviteToken(value: unknown): string | null {
  const one = Array.isArray(value) ? value[0] : value;
  return typeof one === "string" && TOKEN_SHAPE.test(one) ? one : null;
}

export function invitePath(token: string): string {
  return `/invite?token=${token}`;
}
