import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ generateLink: vi.fn(), sendMail: vi.fn(), error: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({ auth: { admin: { generateLink: m.generateLink } } }) }));
vi.mock("@/lib/email/mailer", () => ({ mailConfig: () => null, sendMail: m.sendMail }));
vi.mock("@/lib/logger", () => ({ logger: { error: m.error, warn: vi.fn(), info: vi.fn() } }));

import { confirmationLink, signUpWithPassword } from "./sign-up";

const config = { host: "smtp.test", port: 587, from: "Plan Markup <no-reply@x.test>", appUrl: "https://app.test" };
const EMAIL = "new@x.test";
const PASSWORD = "a long enough password";

beforeEach(() => {
  vi.clearAllMocks();
  m.sendMail.mockResolvedValue("sent");
});

describe("signUpWithPassword (security review M3)", () => {
  it("makes the account with the service role and mails the confirmation link itself", async () => {
    m.generateLink.mockResolvedValue({ data: { properties: { hashed_token: "abc123" } }, error: null });
    await expect(signUpWithPassword(EMAIL, PASSWORD, { config })).resolves.toEqual({ ok: true });
    expect(m.generateLink).toHaveBeenCalledWith({ type: "signup", email: EMAIL, password: PASSWORD });
    const [mail] = m.sendMail.mock.calls[0];
    expect(mail).toMatchObject({ to: EMAIL, subject: "Confirm your Plan Markup account" });
    expect(mail.text).toContain("https://app.test/auth/confirm?token_hash=abc123&type=email");
    expect(mail.html).toContain("https://app.test/auth/confirm?token_hash=abc123&amp;type=email");
  });

  it("answers an existing, confirmed address like a new one and sends nothing (NFR16)", async () => {
    m.generateLink.mockResolvedValue({ data: { properties: null, user: null }, error: { status: 422, code: "email_exists" } });
    await expect(signUpWithPassword(EMAIL, PASSWORD, { config })).resolves.toEqual({ ok: true });
    expect(m.sendMail).not.toHaveBeenCalled();
  });

  it("makes nothing without mail settings", async () => {
    await expect(signUpWithPassword(EMAIL, PASSWORD, { config: null })).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(m.generateLink).not.toHaveBeenCalled();
  });

  it("reports a failed send, and Auth's refusals, as reasons", async () => {
    m.generateLink.mockResolvedValue({ data: { properties: { hashed_token: "abc" } }, error: null });
    m.sendMail.mockResolvedValue("failed");
    await expect(signUpWithPassword(EMAIL, PASSWORD, { config })).resolves.toEqual({ ok: false, reason: "unavailable" });

    m.generateLink.mockResolvedValue({ data: {}, error: { status: 422, code: "weak_password" } });
    await expect(signUpWithPassword(EMAIL, PASSWORD, { config })).resolves.toEqual({ ok: false, reason: "weak_password" });

    m.generateLink.mockResolvedValue({ data: {}, error: { status: 500, code: "unexpected_failure" } });
    await expect(signUpWithPassword(EMAIL, PASSWORD, { config })).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(m.error).toHaveBeenCalledWith("auth.sign_up_upstream_failed", { status: 500, code: "unexpected_failure" });
  });

  it("builds the link on the app's origin", () => {
    expect(confirmationLink("https://app.test", "t&x")).toBe("https://app.test/auth/confirm?token_hash=t%26x&type=email");
  });
});
