import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  checkEmailChangeRateLimit: vi.fn(),
  update: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getAuthUser: m.getAuthUser }));
vi.mock("@/lib/auth/rate-limit", () => ({ checkEmailChangeRateLimit: m.checkEmailChangeRateLimit }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    from: () => ({
      update: (values: unknown) => {
        m.update(values);
        return { eq: () => ({ select: async () => ({ data: [{ name: "x" }], error: null }) }) };
      },
    }),
    auth: { updateUser: m.updateUser },
  }),
}));

import { changeEmail, updateName } from "./profile-actions";

const USER = { id: "u1", email: "me@plan-markup.test", name: "Me", isPlatformAdmin: false };

beforeEach(() => {
  vi.clearAllMocks();
  m.getAuthUser.mockResolvedValue(USER);
  m.checkEmailChangeRateLimit.mockResolvedValue({ allowed: true });
  m.updateUser.mockResolvedValue({ error: null });
});

describe("updateName", () => {
  it("writes only the trimmed name", async () => {
    expect(await updateName({ name: "  Pat Designer " })).toEqual({ ok: true, data: { name: "Pat Designer" } });
    expect(m.update).toHaveBeenCalledWith({ name: "Pat Designer" });
  });

  it("refuses extra (protected) fields, blank and long names, and signed-out callers", async () => {
    expect(await updateName({ name: "x", status: "active" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await updateName({ name: "   " })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await updateName({ name: "a".repeat(101) })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    m.getAuthUser.mockResolvedValueOnce(null);
    expect(await updateName({ name: "x" })).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(m.update).not.toHaveBeenCalled();
  });
});

describe("changeEmail", () => {
  it("asks Auth to change the email (links to both addresses)", async () => {
    expect(await changeEmail({ email: " New@Plan-Markup.test " })).toEqual({ ok: true, data: { email: "new@plan-markup.test" } });
    expect(m.updateUser).toHaveBeenCalledWith({ email: "new@plan-markup.test" });
    expect(m.checkEmailChangeRateLimit).toHaveBeenCalledWith("u1");
  });

  it("refuses the same email, bad input and a protected field", async () => {
    expect(await changeEmail({ email: "ME@plan-markup.test" })).toMatchObject({ ok: false, message: "That is already your email." });
    expect(await changeEmail({ email: "nope" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await changeEmail({ email: "a@b.co", is_platform_admin: true })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(m.updateUser).not.toHaveBeenCalled();
  });

  it("is rate limited per user", async () => {
    m.checkEmailChangeRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });
    expect(await changeEmail({ email: "a@b.co" })).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(m.updateUser).not.toHaveBeenCalled();
  });

  it("answers an address in use like any other, and maps Auth errors", async () => {
    m.updateUser.mockResolvedValueOnce({ error: { code: "email_exists", status: 422 } });
    expect(await changeEmail({ email: "taken@b.co" })).toMatchObject({ ok: true });
    m.updateUser.mockResolvedValueOnce({ error: { code: "over_email_send_rate_limit", status: 429 } });
    expect(await changeEmail({ email: "a@b.co" })).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    m.updateUser.mockResolvedValueOnce({ error: { status: 500 } });
    expect(await changeEmail({ email: "a@b.co" })).toMatchObject({ ok: false, code: "INTERNAL" });
  });
});
