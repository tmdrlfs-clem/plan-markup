// The only file in the app allowed to call console.* (see eslint.config.mjs).
// No Sentry import here: src/lib/sentry/init.ts registers the reporter.
import { redactFields } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogValue = string | number | boolean | null | undefined | Error;
export type LogFields = Record<string, LogValue>;
/** Receives the first Error passed to logger.error, with the event name. */
export type ErrorReporter = (error: Error, event: string) => void;

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveLevel(): LogLevel {
  // Literal property read so Next.js can inline NEXT_PUBLIC_* on the client.
  const raw = process.env.NEXT_PUBLIC_LOG_LEVEL;
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function enabled(level: LogLevel): boolean {
  return ORDER[level] >= ORDER[resolveLevel()];
}

let reporter: ErrorReporter | null = null;

/** Registers (or clears, with null) the reporter that logger.error forwards Errors to. */
export function setErrorReporter(next: ErrorReporter | null): void {
  reporter = next;
}

function firstError(fields: LogFields | undefined): Error | undefined {
  if (!fields) return undefined;
  for (const value of Object.values(fields)) if (value instanceof Error) return value;
  return undefined;
}

function write(level: LogLevel, event: string, fields: LogFields | undefined): void {
  if (!enabled(level)) return;
  const redacted = redactFields(fields);
  if (process.env.NODE_ENV === "production") {
    // One JSON line, so platform logs stay parseable.
    console[level](JSON.stringify({ level, event, ...redacted }));
  } else {
    console[level](event, redacted);
  }
}

function report(event: string, fields: LogFields | undefined): void {
  const error = firstError(fields);
  if (!reporter || !error) return;
  try {
    reporter(error, event);
  } catch {
    // Logging never throws.
  }
}

/**
 * `event` is a constant, developer-written, snake.dotted name such as
 * "auth.rate_limiter_failed". Never interpolate user data into it: field
 * values are redacted, the event name is not.
 */
export const logger = {
  debug(event: string, fields?: LogFields): void {
    write("debug", event, fields);
  },
  info(event: string, fields?: LogFields): void {
    write("info", event, fields);
  },
  warn(event: string, fields?: LogFields): void {
    write("warn", event, fields);
  },
  error(event: string, fields?: LogFields): void {
    write("error", event, fields);
    report(event, fields);
  },
};
