import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getPlatformAdmin: vi.fn(),
  rpc: vi.fn(),
  mailConfig: vi.fn(),
  sendMail: vi.fn(),
  revalidatePath: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/auth", () => ({ getPlatformAdmin: m.getPlatformAdmin }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: m.warn, info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({ rpc: m.rpc }) }));
vi.mock("@/lib/email/mailer", () => ({ mailConfig: m.mailConfig, sendMail: m.sendMail }));

import { setUserStatus } from "./actions";

const ADMIN = { id: "00000000-0000-4000-8000-00000000000a", email: "admin@plan-markup.test", name: "Admin", isPlatformAdmin: true };
const USER_ID = "00000000-0000-4000-8000-00000000000c";
const CONFIG = { host: "h", port: 25, from: "f@x.test", appUrl: "https://app.test" };

function rpcReturns(previous: string) {
  m.rpc.mockResolvedValue({ data: [{ previous_status: previous, email: "pat@plan-markup.test", name: "Pat" }], error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getPlatformAdmin.mockResolvedValue(ADMIN);
  m.mailConfig.mockReturnValue(CONFIG);
  m.sendMail.mockResolvedValue("sent");
  rpcReturns("pending");
});

describe("setUserStatus", () => {
  it("activates through the audited function, as the signed-in admin, and sends the email", async () => {
    expect(await setUserStatus({ userId: USER_ID, status: "active" })).toEqual({
      ok: true,
      data: { status: "active", changed: true, mail: "sent" },
    });
    expect(m.rpc).toHaveBeenCalledWith("admin_set_user_status", { p_actor_id: ADMIN.id, p_user_id: USER_ID, p_status: "active" });
    const [mail, options] = m.sendMail.mock.calls[0] as [{ to: string; subject: string; text: string }, { config: unknown }];
    expect(mail.to).toBe("pat@plan-markup.test");
    expect(mail.text).toContain("https://app.test/sign-in");
    expect(options.config).toBe(CONFIG);
    expect(m.revalidatePath).toHaveBeenCalledWith("/admin/users");
  });

  it("still activates when no mail is configured or the send fails, and says so", async () => {
    m.mailConfig.mockReturnValueOnce(null);
    expect(await setUserStatus({ userId: USER_ID, status: "active" })).toMatchObject({ ok: true, data: { changed: true, mail: "not_configured" } });
    expect(m.sendMail).not.toHaveBeenCalled();
    expect(m.warn).toHaveBeenCalledWith("mail.not_configured", expect.anything());
    m.sendMail.mockResolvedValueOnce("failed");
    expect(await setUserStatus({ userId: USER_ID, status: "active" })).toMatchObject({ ok: true, data: { changed: true, mail: "failed" } });
  });

  it("deactivates without an email", async () => {
    rpcReturns("active");
    expect(await setUserStatus({ userId: USER_ID, status: "deactivated" })).toEqual({ ok: true, data: { status: "deactivated", changed: true } });
    expect(m.sendMail).not.toHaveBeenCalled();
  });

  it("sends no second email when the account was already active", async () => {
    rpcReturns("active");
    expect(await setUserStatus({ userId: USER_ID, status: "active" })).toEqual({ ok: true, data: { status: "active", changed: false } });
    expect(m.sendMail).not.toHaveBeenCalled();
  });

  it("refuses everyone but the platform admin before touching the database", async () => {
    m.getPlatformAdmin.mockResolvedValueOnce(null);
    expect(await setUserStatus({ userId: USER_ID, status: "active" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("refuses bad input, extra fields, the pending status and the admin's own deactivation", async () => {
    expect(await setUserStatus({ userId: "nope", status: "active" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await setUserStatus({ userId: USER_ID, status: "pending" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await setUserStatus({ userId: USER_ID, status: "active", isPlatformAdmin: true })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await setUserStatus({ userId: ADMIN.id, status: "deactivated" })).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("maps the function's refusals and hides other errors", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT404", message: "no such user" } });
    expect(await setUserStatus({ userId: USER_ID, status: "active" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT403", message: "not a platform admin" } });
    expect(await setUserStatus({ userId: USER_ID, status: "active" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "secret detail" } });
    const result = await setUserStatus({ userId: USER_ID, status: "active" });
    expect(result).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(JSON.stringify(result)).not.toContain("secret detail");
    m.rpc.mockRejectedValueOnce(new Error("network"));
    expect(await setUserStatus({ userId: USER_ID, status: "active" })).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(m.sendMail).not.toHaveBeenCalled();
  });
});
