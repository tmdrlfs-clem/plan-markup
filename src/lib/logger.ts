// The only file in the app allowed to call console.* (see eslint.config.mjs).

export type LogLevel = "debug" | "info" | "warn" | "error";

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

export const logger = {
  debug(...args: unknown[]): void {
    if (enabled("debug")) console.debug(...args);
  },
  info(...args: unknown[]): void {
    if (enabled("info")) console.info(...args);
  },
  warn(...args: unknown[]): void {
    if (enabled("warn")) console.warn(...args);
  },
  error(...args: unknown[]): void {
    if (enabled("error")) console.error(...args);
  },
};
