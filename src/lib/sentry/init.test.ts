import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ init: sentry.init, captureException: vi.fn() }));

const logger = vi.hoisted(() => ({ setErrorReporter: vi.fn() }));
vi.mock("@/lib/logger", () => ({ setErrorReporter: logger.setErrorReporter, logger: {} }));

async function load() {
  vi.resetModules();
  return import("./init");
}

beforeEach(() => {
  sentry.init.mockClear();
  logger.setErrorReporter.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("initSentry", () => {
  it("never calls Sentry.init and registers no reporter without a DSN", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const { initSentry } = await load();
    expect(initSentry("browser")).toBe(false);
    expect(initSentry("nodejs")).toBe(false);
    expect(sentry.init).not.toHaveBeenCalled();
    expect(logger.setErrorReporter).not.toHaveBeenCalled();
  });

  it("initialises once with a DSN, even when called twice", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://public@o0.ingest.sentry.io/0");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "preview");
    const { initSentry } = await load();
    expect(initSentry("nodejs")).toBe(true);
    expect(initSentry("nodejs")).toBe(true);
    expect(sentry.init).toHaveBeenCalledTimes(1);
    const options = sentry.init.mock.calls[0][0];
    expect(options.dsn).toBe("https://public@o0.ingest.sentry.io/0");
    expect(options.environment).toBe("preview");
    expect(options.dataCollection.userInfo).toBe(false);
    expect(logger.setErrorReporter).toHaveBeenCalledTimes(1);
    expect(typeof logger.setErrorReporter.mock.calls[0][0]).toBe("function");
  });
});
