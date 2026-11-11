import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({
    error: "NEXT_PUBLIC_SUPABASE_URL must be a valid URL",
  }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string({ error: "NEXT_PUBLIC_SUPABASE_ANON_KEY is required" })
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY must not be empty"),
  NEXT_PUBLIC_SENTRY_DSN: z
    .url({ error: "NEXT_PUBLIC_SENTRY_DSN must be a valid URL" })
    .optional(),
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: z.string().min(1).max(64).optional(),
  // Story 10.1: Cloudflare Turnstile site key. Unset outside production: no widget.
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"], {
      error: "NEXT_PUBLIC_LOG_LEVEL must be one of debug, info, warn, error",
    })
    .optional(),
});

const serverSchema = publicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  // Story 10.1: Turnstile secret (server only). Required in production for sign-up.
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  // Build only (withSentryConfig source-map upload). Unused without SENTRY_AUTH_TOKEN.
  SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
  SENTRY_ORG: z.string().min(1).optional(),
  SENTRY_PROJECT: z.string().min(1).optional(),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

type Source = Record<string, string | undefined>;

// Treat empty strings (e.g. "FOO=" in .env files) as unset.
function clean(source: Source): Source {
  const out: Source = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = value === "" ? undefined : value;
  }
  return out;
}

function parseWith<T extends z.ZodType>(schema: T, source: Source): z.infer<T> {
  const result = schema.safeParse(clean(source));
  if (result.success) return result.data;
  const lines = result.error.issues.map(
    (issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`,
  );
  throw new Error(`Invalid environment variables:\n${lines.join("\n")}`);
}

/** Parse and validate the full (server) environment. Throws one error naming every invalid variable. */
export function parseEnv(source: Source): ServerEnv {
  return parseWith(serverSchema, source);
}

/** Parse only the public (browser-safe) variables. */
export function parsePublicEnv(source: Source): PublicEnv {
  return parseWith(publicSchema, source);
}

let publicCache: PublicEnv | undefined;

/**
 * Validated on first call, not at import, so the default page and `next build`
 * work before Supabase exists. NEXT_PUBLIC_* are read as literal properties so
 * Next.js can inline them in the browser bundle.
 */
export function getPublicEnv(): PublicEnv {
  publicCache ??= parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    NEXT_PUBLIC_LOG_LEVEL: process.env.NEXT_PUBLIC_LOG_LEVEL,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  });
  return publicCache;
}
