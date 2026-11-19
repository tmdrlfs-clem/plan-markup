import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  limit: vi.fn(),
  check: vi.fn(),
  replace: vi.fn(),
  pwned: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getAuthUser: m.getAuthUser }));
vi.mock("@/lib/auth/rate-limit", () => ({ checkPasswordChangeRateLimit: m.limit }));
vi.mock("@/lib/auth/change-password", () => ({ checkCurrentPassword: m.check, replacePassword: m.replace }));
vi.mock("@/lib/auth/pwned", () => ({ isPwnedPassword: m.pwned }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { changePassword } from "./password-change-actions";
import { PASSWORD_CHANGE_MESSAGES } from "./password-change-messages";
import { PASSWORD_MESSAGES } from "./sign-up-schema";

const USER = { id: "u1", email: "me@plan-markup.test", name: "Me", isPlatformAdmin: false };
const OLD = "old-password-123";
const NEW = "new-password-456";

beforeEach(() => {
  vi.clearAllMocks();
  m.getAuthUser.mockResolvedValue(USER);
  m.limit.mockResolvedValue({ allowed: true });
  m.check.mockResolvedValue("ok");
  m.pwned.mockResolvedValue(false);
  m.replace.mockResolvedValue({ ok: true });
});

describe("changePassword", () => {
  it("checks the current password, then sets the new one for this user", async () => {
    expect(await changePassword({ current: OLD, password: NEW })).toEqual({ ok: true, data: null });
    expect(m.check).toHaveBeenCalledWith(USER.email, OLD);
    expect(m.replace).toHaveBeenCalledWith(USER.id, NEW);
  });

  it("answers a wrong current password on its field and changes nothing", async () => {
    m.check.mockResolvedValue("wrong");
    expect(await changePassword({ current: "nope", password: NEW })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      message: PASSWORD_CHANGE_MESSAGES.wrongCurrent,
      field: "current",
    });
    expect(m.replace).not.toHaveBeenCalled();
  });

  it("applies the sign-up rules, refuses the same password and breached ones", async () => {
    expect(await changePassword({ current: "", password: NEW })).toMatchObject({ field: "current", message: PASSWORD_CHANGE_MESSAGES.current });
    expect(await changePassword({ current: OLD, password: "short" })).toMatchObject({ field: "password", message: PASSWORD_MESSAGES.short });
    expect(await changePassword({ current: OLD, password: OLD })).toMatchObject({ field: "password", message: PASSWORD_CHANGE_MESSAGES.same });
    m.pwned.mockResolvedValueOnce(true);
    expect(await changePassword({ current: OLD, password: NEW })).toMatchObject({ field: "password", message: PASSWORD_MESSAGES.pwned });
    expect(m.replace).not.toHaveBeenCalled();
  });

  it("is rate-limited before the current password is tried", async () => {
    m.limit.mockResolvedValue({ allowed: false, retryAfterSeconds: 600 });
    expect(await changePassword({ current: OLD, password: NEW })).toMatchObject({ ok: false, code: "RATE_LIMITED", message: PASSWORD_CHANGE_MESSAGES.tooMany });
    expect(m.check).not.toHaveBeenCalled();
  });

  it("refuses signed-out callers and extra fields", async () => {
    m.getAuthUser.mockResolvedValueOnce(null);
    expect(await changePassword({ current: OLD, password: NEW })).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(await changePassword({ current: OLD, password: NEW, userId: "someone-else" })).toMatchObject({ code: "INVALID_INPUT" });
    expect(m.replace).not.toHaveBeenCalled();
  });

  it("maps Auth's own refusals and outages", async () => {
    m.replace.mockResolvedValueOnce({ ok: false, reason: "same_password" });
    expect(await changePassword({ current: OLD, password: NEW })).toMatchObject({ field: "password", message: PASSWORD_CHANGE_MESSAGES.same });
    m.check.mockResolvedValueOnce("unavailable");
    expect(await changePassword({ current: OLD, password: NEW })).toMatchObject({ code: "INTERNAL" });
    m.check.mockRejectedValueOnce(new Error("down"));
    expect(await changePassword({ current: OLD, password: NEW })).toMatchObject({ code: "INTERNAL" });
  });
});
