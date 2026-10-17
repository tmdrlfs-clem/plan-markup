import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { logger, setErrorReporter } from "./logger";
import { fail, internalError, SAFE_MESSAGES, type ResultCode } from "./result";

let consoleError: MockInstance<typeof console.error>;

const DIRTY = new Error(
  "relation \"profiles\" failed: select * from profiles where email = 'a@b.co'\n    at q (/app/src/lib/db/x.ts:1:1)",
);
const FORBIDDEN_IN_RESULT = ["select", "profiles", "a@b.co", " at ", ".ts"];

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  vi.unstubAllEnvs();
  setErrorReporter(null);
  vi.restoreAllMocks();
});

describe("internalError", () => {
  it("returns only the fixed INTERNAL result", () => {
    const result = internalError("x.failed", DIRTY);
    expect(result).toEqual({ ok: false, code: "INTERNAL", message: SAFE_MESSAGES.INTERNAL });
    const json = JSON.stringify(result);
    for (const s of FORBIDDEN_IN_RESULT) expect(json).not.toContain(s);
  });

  it("logs the event with scrubbed fields", () => {
    const spy = vi.spyOn(logger, "error");
    internalError("x.failed", DIRTY);
    expect(spy).toHaveBeenCalledWith("x.failed", { error: DIRTY });
    const line = consoleError.mock.calls[0][0] as string;
    expect(JSON.parse(line).event).toBe("x.failed");
    expect(line).not.toContain("a@b.co");
  });

  it("reports the error to the registered reporter", () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    internalError("x.failed", DIRTY);
    expect(reporter).toHaveBeenCalledWith(DIRTY, "x.failed");
  });

  it("never stringifies a non-Error value", () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    const result = internalError("x.failed", { text: "Riser note" });
    expect(JSON.stringify(result)).not.toContain("Riser");
    expect(consoleError.mock.calls[0][0]).not.toContain("Riser");
    expect((reporter.mock.calls[0][0] as Error).message).toBe("Non-Error value thrown (object)");
  });
});

describe("fail", () => {
  it("uses the safe message by default", () => {
    expect(fail("NOT_FOUND")).toEqual({ ok: false, code: "NOT_FOUND", message: "This item no longer exists." });
  });

  it("accepts a constant override", () => {
    expect(fail("INVALID_INPUT", "Enter an email.")).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      message: "Enter an email.",
    });
  });
});

describe("SAFE_MESSAGES", () => {
  const codes: ResultCode[] = [
    "NOT_FOUND",
    "FORBIDDEN",
    "CONFLICT",
    "INVALID_INPUT",
    "RATE_LIMITED",
    "INTERNAL",
    "UNAUTHENTICATED",
  ];

  it("has a non-empty message for every code", () => {
    expect(Object.keys(SAFE_MESSAGES).sort()).toEqual([...codes].sort());
    for (const code of codes) expect(SAFE_MESSAGES[code].length).toBeGreaterThan(0);
  });

  it("holds the exact copy", () => {
    expect(SAFE_MESSAGES).toEqual({
      NOT_FOUND: "This item no longer exists.",
      FORBIDDEN: "You don't have access to this.",
      CONFLICT: "This changed somewhere else. Reload to see the latest version.",
      INVALID_INPUT: "Check the highlighted fields.",
      RATE_LIMITED: "Too many requests. Try again in a few minutes.",
      INTERNAL: "Something went wrong on our side. Try again shortly.",
      UNAUTHENTICATED: "Sign in to continue.",
    });
  });
});
