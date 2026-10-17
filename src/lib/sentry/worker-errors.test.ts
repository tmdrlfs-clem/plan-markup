import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachWorkerErrorReporting, reportWorkerError } from "./worker-errors";

const report = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/lib/sentry/report", () => ({ reportError: report.reportError }));
vi.mock("./report", () => ({ reportError: report.reportError }));

const DRAWING_ID = "11111111-2222-4333-8444-555555555555";

function fakeWorker() {
  return new EventTarget() as unknown as Worker;
}

function errorEvent(init: { message?: string; lineno?: number; colno?: number; filename?: string }): Event {
  const event = new Event("error");
  return Object.assign(event, init);
}

beforeEach(() => {
  report.reportError.mockReset();
});

describe("reportWorkerError", () => {
  it("rebuilds an Error and reports it with the worker and drawing id", () => {
    reportWorkerError("engine", { name: "RangeError", message: "bad", stack: "RangeError: bad\n at x" }, DRAWING_ID);
    const [error, opts] = report.reportError.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("RangeError");
    expect(error.message).toBe("bad");
    expect(error.stack).toBe("RangeError: bad\n at x");
    expect(opts).toEqual({ worker: "engine", drawingId: DRAWING_ID });
  });
});

describe("attachWorkerErrorReporting", () => {
  it("reports an uncaught error once, without the filename", () => {
    const worker = fakeWorker();
    attachWorkerErrorReporting(worker, "render", () => DRAWING_ID);
    worker.dispatchEvent(
      errorEvent({ message: "Uncaught TypeError: x", lineno: 3, colno: 7, filename: "http://h/_next/static/w.js" }),
    );
    expect(report.reportError).toHaveBeenCalledTimes(1);
    const [error, opts] = report.reportError.mock.calls[0];
    expect(error.name).toBe("WorkerError");
    expect(error.message).toBe("Uncaught TypeError: x (line 3:7)");
    expect(error.message).not.toContain("_next");
    expect(opts).toEqual({ worker: "render", drawingId: DRAWING_ID });
  });

  it("uses a fixed message when the event has none", () => {
    const worker = fakeWorker();
    attachWorkerErrorReporting(worker, "export");
    worker.dispatchEvent(errorEvent({}));
    expect(report.reportError.mock.calls[0][0].message).toBe("Uncaught worker error");
    expect(report.reportError.mock.calls[0][1]).toEqual({ worker: "export", drawingId: undefined });
  });

  it("reports messageerror", () => {
    const worker = fakeWorker();
    attachWorkerErrorReporting(worker, "engine", () => null);
    worker.dispatchEvent(new Event("messageerror"));
    expect(report.reportError).toHaveBeenCalledTimes(1);
    const [error, opts] = report.reportError.mock.calls[0];
    expect(error.name).toBe("WorkerMessageError");
    expect(error.message).toBe("Worker message could not be deserialised");
    expect(opts).toEqual({ worker: "engine", drawingId: null });
  });

  it("stops reporting after detach", () => {
    const worker = fakeWorker();
    const detach = attachWorkerErrorReporting(worker, "engine");
    detach();
    worker.dispatchEvent(errorEvent({ message: "x" }));
    worker.dispatchEvent(new Event("messageerror"));
    expect(report.reportError).not.toHaveBeenCalled();
  });
});
