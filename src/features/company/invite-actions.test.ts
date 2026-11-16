import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  readAuthState: vi.fn(),
  rpc: vi.fn(),
  createUser: vi.fn(),
  isPwnedPassword: vi.fn(),
  checkSignUpRateLimit: vi.fn(),
  signInWithPassword: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "203.0.113.9" }) }));
vi.mock("@/lib/auth", () => ({ readAuthState: m.readAuthState }));
vi.mock("@/lib/auth/pwned", () => ({ isPwnedPassword: m.isPwnedPassword }));
vi.mock("@/lib/auth/rate-limit", () => ({ checkSignUpRateLimit: m.checkSignUpRateLimit }));
vi.mock("@/lib/auth/sign-in", () => ({ signInWithPassword: m.signInWithPassword }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({ rpc: m.rpc, auth: { admin: { createUser: m.createUser } } }) }));

import { hashInviteToken, newInviteToken } from "@/lib/invite-token";
import { joinCompany, joinWithNewAccount, type InviteState } from "./invite-actions";

const IDLE: InviteState = { status: "idle" };
const { token } = newInviteToken();
const HASH = hashInviteToken(token);
const USER_ID = "00000000-0000-4000-8000-00000000000c";
const PASSWORD = "a long enough password";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function rpcByName(answers: Record<string, unknown>) {
  m.rpc.mockImplementation(async (name: string) => answers[name] ?? { data: null, error: null });
}

const OPEN = { data: [{ invitation_id: "i1", company_name: "Acme Fire", email: "pat@acme.test", role: "member", state: "open", account_exists: false }], error: null };

beforeEach(() => {
  vi.clearAllMocks();
  m.readAuthState.mockResolvedValue({ kind: "inactive", userId: USER_ID, email: "pat@acme.test", status: "pending" });
  m.isPwnedPassword.mockResolvedValue(false);
  m.checkSignUpRateLimit.mockResolvedValue({ allowed: true });
  m.signInWithPassword.mockResolvedValue({ ok: true });
  m.createUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  rpcByName({ get_company_invitation: OPEN });
});

describe("joinCompany", () => {
  it("accepts for the signed-in user, pending accounts included, and opens the workspace", async () => {
    await expect(joinCompany(IDLE, form({ token }))).rejects.toThrow("REDIRECT:/workspace");
    expect(m.rpc).toHaveBeenCalledWith("accept_company_invitation", { p_token_hash: HASH, p_user_id: USER_ID });
    m.readAuthState.mockResolvedValueOnce({ kind: "active", user: { id: "active-id" } });
    await expect(joinCompany(IDLE, form({ token }))).rejects.toThrow("REDIRECT:/workspace");
    expect(m.rpc).toHaveBeenLastCalledWith("accept_company_invitation", { p_token_hash: HASH, p_user_id: "active-id" });
  });

  it("refuses a malformed token and a signed-out visitor without touching the database", async () => {
    expect(await joinCompany(IDLE, form({ token: "short" }))).toMatchObject({ status: "error", message: expect.stringContaining("no longer valid") });
    m.readAuthState.mockResolvedValueOnce({ kind: "anonymous" });
    expect(await joinCompany(IDLE, form({ token }))).toEqual({ status: "error", message: "Sign in to join." });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("explains each refusal of the database function", async () => {
    const cases: [string, string][] = [
      ["PT404", "no longer valid"],
      ["PT410", "no longer valid"],
      ["PT403", "another email address"],
      ["PT422", "not active"],
      ["PT409", "already a member"],
      ["PT423", "another company"],
      ["XX000", "unavailable right now"],
    ];
    for (const [code, text] of cases) {
      rpcByName({ accept_company_invitation: { data: null, error: { code, message: "secret detail" } } });
      const result = await joinCompany(IDLE, form({ token }));
      expect(result).toMatchObject({ status: "error", message: expect.stringContaining(text) });
      expect(JSON.stringify(result)).not.toContain("secret detail");
    }
    expect(m.redirect).not.toHaveBeenCalled();
  });
});

describe("joinWithNewAccount", () => {
  it("makes a confirmed account for the invited email, joins and signs in", async () => {
    await expect(joinWithNewAccount(IDLE, form({ token, password: PASSWORD, email: "evil@other.test" }))).rejects.toThrow("REDIRECT:/workspace");
    // The email is the invitation's, whatever the form carried.
    expect(m.createUser).toHaveBeenCalledWith({ email: "pat@acme.test", password: PASSWORD, email_confirm: true });
    expect(m.rpc).toHaveBeenCalledWith("accept_company_invitation", { p_token_hash: HASH, p_user_id: USER_ID });
    expect(m.signInWithPassword).toHaveBeenCalledWith("pat@acme.test", PASSWORD);
    expect(m.checkSignUpRateLimit).toHaveBeenCalledWith({ ip: "203.0.113.9", email: "pat@acme.test" });
  });

  it("checks the password before anything else", async () => {
    expect(await joinWithNewAccount(IDLE, form({ token, password: "short" }))).toMatchObject({ status: "error", passwordError: "Use at least 12 characters." });
    expect(m.rpc).not.toHaveBeenCalled();
    m.isPwnedPassword.mockResolvedValueOnce(true);
    expect(await joinWithNewAccount(IDLE, form({ token, password: PASSWORD }))).toMatchObject({ status: "error", passwordError: expect.stringContaining("data breach") });
    expect(m.createUser).not.toHaveBeenCalled();
  });

  it("makes no account for an invitation that is not open, or for an email that has one", async () => {
    for (const state of ["expired", "revoked", "accepted"]) {
      rpcByName({ get_company_invitation: { data: [{ ...OPEN.data[0], state }], error: null } });
      expect(await joinWithNewAccount(IDLE, form({ token, password: PASSWORD }))).toMatchObject({ status: "error", message: expect.stringContaining("no longer valid") });
    }
    rpcByName({ get_company_invitation: { data: [], error: null } });
    expect(await joinWithNewAccount(IDLE, form({ token, password: PASSWORD }))).toMatchObject({ status: "error", message: expect.stringContaining("no longer valid") });
    rpcByName({ get_company_invitation: { data: [{ ...OPEN.data[0], account_exists: true }], error: null } });
    expect(await joinWithNewAccount(IDLE, form({ token, password: PASSWORD }))).toMatchObject({ status: "error", message: expect.stringContaining("already has an account") });
    expect(m.createUser).not.toHaveBeenCalled();
  });

  it("is rate-limited like sign-up and fails closed", async () => {
    m.checkSignUpRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });
    expect(await joinWithNewAccount(IDLE, form({ token, password: PASSWORD }))).toMatchObject({ status: "error", message: expect.stringContaining("Too many attempts") });
    m.checkSignUpRateLimit.mockRejectedValueOnce(new Error("down"));
    expect(await joinWithNewAccount(IDLE, form({ token, password: PASSWORD }))).toMatchObject({ status: "error", message: expect.stringContaining("unavailable") });
    expect(m.createUser).not.toHaveBeenCalled();
  });

  it("reports an account that appeared meanwhile, and a failed join, without signing in", async () => {
    m.createUser.mockResolvedValueOnce({ data: { user: null }, error: { code: "email_exists", status: 422 } });
    expect(await joinWithNewAccount(IDLE, form({ token, password: PASSWORD }))).toMatchObject({ status: "error", message: expect.stringContaining("already has an account") });
    rpcByName({ get_company_invitation: OPEN, accept_company_invitation: { data: null, error: { code: "PT410" } } });
    expect(await joinWithNewAccount(IDLE, form({ token, password: PASSWORD }))).toMatchObject({ status: "error", message: expect.stringContaining("no longer valid") });
    expect(m.signInWithPassword).not.toHaveBeenCalled();
  });

  it("sends to sign-in when the session could not be opened after joining", async () => {
    m.signInWithPassword.mockResolvedValueOnce({ ok: false, reason: "unavailable" });
    await expect(joinWithNewAccount(IDLE, form({ token, password: PASSWORD }))).rejects.toThrow("REDIRECT:/sign-in");
  });
});
