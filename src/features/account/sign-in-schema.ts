import { z } from "zod";

export const SignInSchema = z.object({
  email: z
    .string({ error: "Enter your email address." })
    .trim()
    .toLowerCase()
    .min(1, "Enter your email address.")
    .max(254, "Enter a valid email address.")
    .pipe(z.email({ error: "Enter a valid email address." })),
  // No length rule at sign-in: the 12-char minimum applies when a password is set.
  password: z
    .string({ error: "Enter your password." })
    .min(1, "Enter your password.")
    .max(1024, "Email or password is incorrect."),
  next: z.string().max(2048).optional(),
});

export type SignInInput = z.infer<typeof SignInSchema>;
