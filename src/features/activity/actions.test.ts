import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getAuthUser: vi.fn(), insert: vi.fn(), error: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getAuthUser: m.getAuthUser }));
vi.mock("@/lib/logger", () => ({ logger: { error: m.error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    from: (table: string) => {
      expect(table).toBe("activity_events");
      return { insert: m.insert };
    },
  }),
}));

import { recordActivity } from "./actions";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "a@b.test", name: "A", isPlatformAdmin: false, theme: "blueprint" };
const SET = "00000000-0000-7000-8000-000000000001";
const EVENT = { name: "markup.exported", drawingId: SET, pageCount: 2, markupCount: 5, kind: "editable" };

beforeEach(() => {
  vi.clearAllMocks();
  m.getAuthUser.mockResolvedValue(USER);
  m.insert.mockResolvedValue({ error: null });
});

describe("recordActivity (Story 8.4)", () => {
  it("inserts the event as the user (the time and user are the server's)", async () => {
    await expect(recordActivity(EVENT)).resolves.toEqual({ ok: true, data: null });
    expect(m.insert).toHaveBeenCalledWith({ name: "markup.exported", drawing_id: SET, page_count: 2, markup_count: 5, kind: "editable" });
  });

  it("refuses without a user or with bad input; maps refusals", async () => {
    m.getAuthUser.mockResolvedValue(null);
    await expect(recordActivity(EVENT)).resolves.toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    m.getAuthUser.mockResolvedValue(USER);
    await expect(recordActivity({ ...EVENT, title: "A1721" })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(m.insert).not.toHaveBeenCalled();
    m.insert.mockResolvedValue({ error: { code: "PT429", message: "rate limited" } });
    await expect(recordActivity(EVENT)).resolves.toMatchObject({ ok: false, code: "RATE_LIMITED" });
    m.insert.mockResolvedValue({ error: { code: "42501", message: "no" } });
    await expect(recordActivity(EVENT)).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    m.insert.mockResolvedValue({ error: { code: "XX000", message: "boom" } });
    await expect(recordActivity(EVENT)).resolves.toMatchObject({ ok: false, code: "INTERNAL" });
    expect(m.error).toHaveBeenCalledWith("activity.record_failed", expect.anything());
  });
});
