import { z } from "zod";

/** Password rules (NFR18): at least 12 characters; Auth's limit is 72 bytes, so no maximum below 64 characters. */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_MESSAGES = {
  empty: "Enter a password.",
  short: `Use at least ${PASSWORD_MIN} characters.`,
  long: `Use at most ${PASSWORD_MAX_BYTES} characters (fewer if it has accented or non-Latin letters).`,
  pwned: "This password has appeared in a data breach. Choose a different one.",
} as const;

export const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

/** The same check as the schema, for the form's on-blur messages. */
export function passwordProblem(value: string): string | undefined {
  if (value === "") return PASSWORD_MESSAGES.empty;
  if ([...value].length < PASSWORD_MIN) return PASSWORD_MESSAGES.short;
  if (utf8Bytes(value) > PASSWORD_MAX_BYTES) return PASSWORD_MESSAGES.long;
  return undefined;
}

export const SignUpSchema = z.object({
  email: z
    .string({ error: "Enter your email address." })
    .trim()
    .toLowerCase()
    .min(1, "Enter your email address.")
    .max(254, "Enter a valid email address.")
    .pipe(z.email({ error: "Enter a valid email address." })),
  password: z
    .string({ error: PASSWORD_MESSAGES.empty })
    .max(1024, PASSWORD_MESSAGES.long)
    .superRefine((value, ctx) => {
      const problem = passwordProblem(value);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
});

export type SignUpInput = z.infer<typeof SignUpSchema>;
