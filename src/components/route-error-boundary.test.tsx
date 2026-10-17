// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteErrorBoundary } from "./route-error-boundary";

const log = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: log.error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
const report = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/lib/sentry/report", () => ({ reportError: report.reportError }));

const originalLocation = window.location;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("RouteErrorBoundary", () => {
  it("logs and reports a digest-less (client) error once", () => {
    const error = new Error("client boom");
    render(<RouteErrorBoundary error={error} />);
    expect(log.error).toHaveBeenCalledWith("route.error_boundary", { error });
    expect(report.reportError).toHaveBeenCalledTimes(1);
    expect(report.reportError).toHaveBeenCalledWith(error, { event: "route.error_boundary" });
  });

  it("does not report a server error that has a digest", () => {
    render(<RouteErrorBoundary error={Object.assign(new Error("x"), { digest: "123" })} />);
    expect(report.reportError).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith("route.error_boundary", { digest: "123" });
  });

  it("wraps a thrown non-Error value without stringifying it", () => {
    render(<RouteErrorBoundary error={{ text: "Riser note" }} />);
    const [reported] = report.reportError.mock.calls[0];
    expect(reported).toBeInstanceOf(Error);
    expect(reported.message).toBe("Non-Error value thrown (object)");
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("Riser");
  });

  it("Reload does a full page reload", async () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, reload } });
    render(<RouteErrorBoundary error={new Error("x")} />);
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
