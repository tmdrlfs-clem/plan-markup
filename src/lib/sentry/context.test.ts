import { beforeEach, describe, expect, it, vi } from "vitest";
import { setDrawingContext } from "./context";

const sentry = vi.hoisted(() => ({ setTag: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ setTag: sentry.setTag }));

const log = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: log.warn } }));

beforeEach(() => {
  sentry.setTag.mockReset();
  log.warn.mockReset();
});

describe("setDrawingContext", () => {
  it("sets the tag for a UUID (non-RFC accepted)", () => {
    setDrawingContext("00000000-0000-4000-8000-000000000001");
    expect(sentry.setTag).toHaveBeenCalledWith("drawing_id", "00000000-0000-4000-8000-000000000001");
    setDrawingContext("ABCDEF01-2345-6789-ABCD-EF0123456789");
    expect(sentry.setTag).toHaveBeenLastCalledWith("drawing_id", "ABCDEF01-2345-6789-ABCD-EF0123456789");
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("clears the tag for null without a warning", () => {
    setDrawingContext(null);
    expect(sentry.setTag).toHaveBeenCalledWith("drawing_id", undefined);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("clears the tag and warns without the value for anything else", () => {
    setDrawingContext("Level 2 Fire.pdf");
    expect(sentry.setTag).toHaveBeenCalledWith("drawing_id", undefined);
    expect(log.warn).toHaveBeenCalledWith("sentry.invalid_drawing_id");
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("Level");
  });
});
