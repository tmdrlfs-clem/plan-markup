import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger, setErrorReporter } from "./logger";

const spies = {
  debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
  info: vi.spyOn(console, "info").mockImplementation(() => {}),
  warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
  error: vi.spyOn(console, "error").mockImplementation(() => {}),
};

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockClear();
  setErrorReporter(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  setErrorReporter(null);
});

describe("level gating", () => {
  it("drops levels below NEXT_PUBLIC_LOG_LEVEL", () => {
    vi.stubEnv("NEXT_PUBLIC_LOG_LEVEL", "warn");
    logger.info("x.info");
    logger.warn("x.warn");
    expect(spies.info).not.toHaveBeenCalled();
    expect(spies.warn).toHaveBeenCalledTimes(1);
  });

  it("defaults to info in production and debug otherwise", () => {
    vi.stubEnv("NEXT_PUBLIC_LOG_LEVEL", "");
    vi.stubEnv("NODE_ENV", "production");
    logger.debug("x.debug");
    logger.info("x.info");
    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledTimes(1);
    vi.stubEnv("NODE_ENV", "development");
    logger.debug("x.debug");
    expect(spies.debug).toHaveBeenCalledTimes(1);
  });
});

describe("redaction", () => {
  it("keeps only safe fields in clear text", () => {
    vi.stubEnv("NODE_ENV", "development");
    logger.warn("x.redact", { email: "a@b.co", password: "x", token: "t", fileName: "L2.pdf", status: 429 });
    const [event, fields] = spies.warn.mock.calls[0];
    expect(event).toBe("x.redact");
    expect(fields).toEqual({
      email: "[redacted]",
      password: "[redacted]",
      token: "[redacted]",
      fileName: "[redacted]",
      status: 429,
    });
  });

  it("scrubs Error messages and drops the stack in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    logger.error("x.failed", { error: new Error("cannot open L2.pdf for a@b.co") });
    const line = spies.error.mock.calls[0][0] as string;
    expect(line).not.toContain("a@b.co");
    expect(line).not.toContain("L2.pdf");
    const parsed = JSON.parse(line);
    expect(parsed.error).toEqual({ name: "Error", message: "cannot open [file] for [email]" });
    expect(parsed.error.stack).toBeUndefined();
  });

  it("writes one valid JSON line in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    logger.info("x.json", { status: 200, detail: "line1\nline2" });
    expect(spies.info.mock.calls[0]).toHaveLength(1);
    const line = spies.info.mock.calls[0][0] as string;
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({ level: "info", event: "x.json", status: 200, detail: "line1\nline2" });
  });
});

describe("error reporter", () => {
  it("receives the Error from logger.error only", () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    const error = new Error("boom");
    logger.warn("x.warn", { error });
    logger.info("x.info", { error });
    expect(reporter).not.toHaveBeenCalled();
    logger.error("x.failed", { status: 500, error });
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter).toHaveBeenCalledWith(error, "x.failed");
  });

  it("is not called without an Error", () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    logger.error("x.failed", { status: 500 });
    logger.error("x.failed");
    expect(reporter).not.toHaveBeenCalled();
  });

  it("reports even when the level gate drops the line", () => {
    vi.stubEnv("NEXT_PUBLIC_LOG_LEVEL", "error");
    const reporter = vi.fn();
    setErrorReporter(reporter);
    logger.error("x.failed", { error: new Error("boom") });
    expect(reporter).toHaveBeenCalledTimes(1);
  });

  it("never throws when the reporter throws", () => {
    setErrorReporter(() => {
      throw new Error("reporter down");
    });
    expect(() => logger.error("x.failed", { error: new Error("boom") })).not.toThrow();
  });

  it("stops reporting after setErrorReporter(null)", () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    setErrorReporter(null);
    logger.error("x.failed", { error: new Error("boom") });
    expect(reporter).not.toHaveBeenCalled();
  });
});
