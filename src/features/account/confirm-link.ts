import { z } from "zod";

// The kinds of link our emails carry (sign-up confirmation, password reset, email change).
export const LINK_TYPES = ["email", "signup", "recovery", "email_change"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

const LinkSchema = z.object({
  token_hash: z.string().min(1).max(512),
  type: z.enum(LINK_TYPES),
});

/** The checked token and type of an emailed link, or null. */
export function parseLink(input: { token_hash?: unknown; type?: unknown }): { tokenHash: string; type: LinkType } | null {
  const parsed = LinkSchema.safeParse(input);
  return parsed.success ? { tokenHash: parsed.data.token_hash, type: parsed.data.type } : null;
}

/** Where each kind of link leads once its token is used. */
export function landing(type: LinkType, newEmailPending: boolean): string {
  if (type === "recovery") return "/reset-password";
  if (type === "email_change") return newEmailPending ? "/email-change?step=other" : "/email-change?step=done";
  return "/pending-activation";
}
