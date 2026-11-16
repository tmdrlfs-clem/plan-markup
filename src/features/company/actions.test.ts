import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getCompanyAdmin: vi.fn(),
  rpc: vi.fn(),
  mailConfig: vi.fn(),
  sendMail: vi.fn(),
  checkInviteRateLimit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("./guard", () => ({ getCompanyAdmin: m.getCompanyAdmin }));
vi.mock("@/lib/auth/rate-limit", () => ({ checkInviteRateLimit: m.checkInviteRateLimit }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({ rpc: m.rpc }) }));
vi.mock("@/lib/email/mailer", () => ({ mailConfig: m.mailConfig, sendMail: m.sendMail }));

import { hashInviteToken } from "@/lib/invite-token";
import { inviteMember, revokeInvitation } from "./actions";

const ADMIN = {
  user: { id: "00000000-0000-4000-8000-00000000000a", email: "boss@acme.test", name: "Bo Boss", isPlatformAdmin: false },
  membership: { companyId: "c1", companyName: "Acme Fire", role: "admin" },
};
const INVITATION_ID = "00000000-0000-4000-8000-0000000000f1";
const CONFIG = { host: "h", port: 25, from: "f@x.test", appUrl: "https://app.test" };

beforeEach(() => {
  vi.clearAllMocks();
  m.getCompanyAdmin.mockResolvedValue(ADMIN);
  m.mailConfig.mockReturnValue(CONFIG);
  m.sendMail.mockResolvedValue("sent");
  m.checkInviteRateLimit.mockResolvedValue({ allowed: true });
  m.rpc.mockResolvedValue({ data: [{ invitation_id: INVITATION_ID, company_id: "c1", company_name: "Acme Fire", expires_at: "2026-11-25T00:00:00Z" }], error: null });
});

describe("inviteMember", () => {
  it("stores only the token's hash and emails the link to the invited address", async () => {
    expect(await inviteMember({ email: " Pat@Acme.test ", role: "viewer" })).toEqual({ ok: true, data: { email: "pat@acme.test" } });
    const [name, args] = m.rpc.mock.calls[0] as [string, { p_actor_id: string; p_email: string; p_role: string; p_token_hash: string }];
    expect(name).toBe("create_company_invitation");
    expect(args).toMatchObject({ p_actor_id: ADMIN.user.id, p_email: "pat@acme.test", p_role: "viewer" });
    const [mail] = m.sendMail.mock.calls[0] as [{ to: string; subject: string; text: string }];
    expect(mail.to).toBe("pat@acme.test");
    expect(mail.subject).toBe("Join Acme Fire on Plan Markup");
    expect(mail.text).toContain("Bo Boss invited you to join Acme Fire on Plan Markup as a viewer.");
    const token = /https:\/\/app\.test\/invite\?token=([A-Za-z0-9_-]{43})\b/.exec(mail.text)?.[1];
    expect(token).toBeDefined();
    expect(hashInviteToken(token as string)).toBe(args.p_token_hash);
    expect(JSON.stringify(m.rpc.mock.calls)).not.toContain(token);
    expect(m.checkInviteRateLimit).toHaveBeenCalledWith(ADMIN.user.id);
    expect(m.revalidatePath).toHaveBeenCalledWith("/company/members");
  });

  it("refuses everyone but a company admin, and bad input, before touching the database", async () => {
    m.getCompanyAdmin.mockResolvedValueOnce(null);
    expect(await inviteMember({ email: "pat@acme.test", role: "member" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await inviteMember({ email: "nope", role: "member" })).toMatchObject({ ok: false, code: "INVALID_INPUT", field: "email" });
    expect(await inviteMember({ email: "pat@acme.test", role: "owner" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await inviteMember({ email: "pat@acme.test", role: "member", companyId: "c2" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.checkInviteRateLimit).not.toHaveBeenCalled();
  });

  it("is rate-limited, and fails closed when the limiter cannot be reached", async () => {
    m.checkInviteRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 600 });
    expect(await inviteMember({ email: "pat@acme.test", role: "member" })).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    m.checkInviteRateLimit.mockRejectedValueOnce(new Error("down"));
    expect(await inviteMember({ email: "pat@acme.test", role: "member" })).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("says clearly when the person is already a member or belongs to another company", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409" } });
    expect(await inviteMember({ email: "pat@acme.test", role: "member" })).toMatchObject({
      ok: false,
      code: "CONFLICT",
      field: "email",
      message: "This person is already a member of your company.",
    });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT423" } });
    expect(await inviteMember({ email: "pat@acme.test", role: "member" })).toMatchObject({
      ok: false,
      code: "CONFLICT",
      field: "email",
      message: expect.stringContaining("already belongs to another company"),
    });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT403" } });
    expect(await inviteMember({ email: "pat@acme.test", role: "member" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(m.sendMail).not.toHaveBeenCalled();
  });

  it("makes no invitation without mail settings, and withdraws one whose email failed", async () => {
    m.mailConfig.mockReturnValueOnce(null);
    expect(await inviteMember({ email: "pat@acme.test", role: "member" })).toMatchObject({ ok: false, code: "INTERNAL", message: expect.stringContaining("could not be sent") });
    expect(m.rpc).not.toHaveBeenCalled();

    m.sendMail.mockResolvedValueOnce("failed");
    m.rpc.mockResolvedValueOnce({ data: [{ invitation_id: INVITATION_ID, company_name: "Acme Fire" }], error: null }).mockResolvedValueOnce({ data: null, error: null });
    expect(await inviteMember({ email: "pat@acme.test", role: "member" })).toMatchObject({ ok: false, code: "INTERNAL", message: expect.stringContaining("could not be sent") });
    expect(m.rpc).toHaveBeenLastCalledWith("revoke_company_invitation", { p_actor_id: ADMIN.user.id, p_invitation_id: INVITATION_ID });
  });

  it("hides other errors", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "secret detail" } });
    const result = await inviteMember({ email: "pat@acme.test", role: "member" });
    expect(result).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(JSON.stringify(result)).not.toContain("secret detail");
  });
});

describe("revokeInvitation", () => {
  it("withdraws through the audited function, as the signed-in admin", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await revokeInvitation({ invitationId: INVITATION_ID })).toEqual({ ok: true, data: { invitationId: INVITATION_ID } });
    expect(m.rpc).toHaveBeenCalledWith("revoke_company_invitation", { p_actor_id: ADMIN.user.id, p_invitation_id: INVITATION_ID });
  });

  it("refuses non-admins and bad ids, and maps the function's refusals", async () => {
    m.getCompanyAdmin.mockResolvedValueOnce(null);
    expect(await revokeInvitation({ invitationId: INVITATION_ID })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await revokeInvitation({ invitationId: "nope" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(m.rpc).not.toHaveBeenCalled();
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT404" } });
    expect(await revokeInvitation({ invitationId: INVITATION_ID })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409" } });
    expect(await revokeInvitation({ invitationId: INVITATION_ID })).toMatchObject({ ok: false, code: "CONFLICT" });
  });
});
