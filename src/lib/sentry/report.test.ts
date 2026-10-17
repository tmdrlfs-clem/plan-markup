import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportError, reportLoggedError } from "./report";

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: sentry.captureException }));

const DRAWING_ID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  sentry.captureException.mockReset();
});

describe("reportError", () => {
  it("captures with no tags by default", () => {
    const error = new Error("x");
    reportError(error);
    expect(sentry.captureException).toHaveBeenCalledWith(error, undefined);
  });

  it("adds only allowlisted tags", () => {
    const error = new Error("x");
    reportError(error, { drawingId: DRAWING_ID, worker: "engine", event: "route.error_boundary" });
    expect(sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { drawing_id: DRAWING_ID, worker: "engine", log_event: "route.error_boundary" },
    });
  });

  it("drops an unsafe drawing id, worker or event", () => {
    reportError(new Error("x"), {
      drawingId: "Level 2.pdf",
      worker: "evil" as never,
      event: "failed for a@b.co",
    });
    expect(sentry.captureException.mock.calls[0][1]).toBeUndefined();
  });

  it("never throws when the SDK throws", () => {
    sentry.captureException.mockImplementation(() => {
      throw new Error("sdk");
    });
    expect(() => reportError(new Error("x"))).not.toThrow();
  });
});

describe("reportLoggedError", () => {
  it("sends the logger event as log_event", () => {
    const error = new Error("x");
    reportLoggedError(error, "auth.rate_limiter_failed");
    expect(sentry.captureException).toHaveBeenCalledWith(error, { tags: { log_event: "auth.rate_limiter_failed" } });
  });
});
