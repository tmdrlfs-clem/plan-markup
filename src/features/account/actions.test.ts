import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  checkSignInRateLimit: vi.fn(),
  signInWithPassword: vi.fn(),
  signOutCurrentSession: vi.fn(),
  readAuthState: vi.fn(),
  getAuthState: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7" }),
}));
vi.mock("@/lib/auth", () => ({ readAuthState: m.readAuthState, getAuthState: m.getAuthState }));
vi.mock("@/lib/auth/rate-limit", () => ({ checkSignInRateLimit: m.checkSignInRateLimit }));
vi.mock("@/lib/auth/sign-in", () => ({
  signInWithPassword: m.signInWithPassword,
  signOutCurrentSession: m.signOutCurrentSession,
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { signIn, signOut, type SignInState } from "./actions";

const IDLE: SignInState = { status: "idle" };

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

const VALID = { email: " User@Plan-Markup.test ", password: "password123", next: "/workspace?x=1" };

beforeEach(() => {
  vi.clearAllMocks();
  m.checkSignInRateLimit.mockResolvedValue({ allowed: true });
  m.signInWithPassword.mockResolvedValue({ ok: true });
  m.readAuthState.mockResolvedValue({
    kind: "active",
    user: { id: "u", email: "user@plan-markup.test", name: "", isPlatformAdmin: false },
  });
});

describe("signIn", () => {
  it("returns INVALID_INPUT with a field error and calls neither the limiter nor Supabase", async () => {
    const state = await signIn(IDLE, form({ email: "not-an-email", password: "x" }));
    expect(state).toMatchObject({
      status: "error",
      code: "INVALID_INPUT",
      fieldErrors: { email: "Enter a valid email address." },
    });
    expect(m.checkSignInRateLimit).not.toHaveBeenCalled();
    expect(m.signInWithPassword).not.toHaveBeenCalled();
  });

  it("reports empty fields", async () => {
    const state = await signIn(IDLE, form({ email: "", password: "" }));
    expect(state).toMatchObject({
      code: "INVALID_INPUT",
      fieldErrors: { email: "Enter your email address.", password: "Enter your password." },
    });
  });

  it("returns RATE_LIMITED without calling Supabase", async () => {
    m.checkSignInRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 900 });
    const state = await signIn(IDLE, form(VALID));
    expect(state).toEqual({
      status: "error",
      code: "RATE_LIMITED",
      message: "Too many sign-in attempts. Try again in 15 minutes.",
    });
    expect(m.signInWithPassword).not.toHaveBeenCalled();
  });

  it("uses the singular for one minute", async () => {
    m.checkSignInRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 });
    const state = await signIn(IDLE, form(VALID));
    expect(state).toMatchObject({ message: "Too many sign-in attempts. Try again in 1 minute." });
  });

  it("passes the client IP and the normalised email to the limiter", async () => {
    await expect(signIn(IDLE, form(VALID))).rejects.toThrow("REDIRECT:");
    expect(m.checkSignInRateLimit).toHaveBeenCalledWith({
      ip: "203.0.113.7",
      email: "user@plan-markup.test",
    });
    expect(m.signInWithPassword).toHaveBeenCalledWith("user@plan-markup.test", "password123");
  });

  it("returns exactly the generic message for invalid credentials", async () => {
    m.signInWithPassword.mockResolvedValue({ ok: false, reason: "invalid" });
    const state = await signIn(IDLE, form(VALID));
    expect(state).toEqual({
      status: "error",
      code: "UNAUTHENTICATED",
      message: "Email or password is incorrect.",
    });
  });

  it("maps a Supabase 429 to RATE_LIMITED", async () => {
    m.signInWithPassword.mockResolvedValue({ ok: false, reason: "rate_limited" });
    const state = await signIn(IDLE, form(VALID));
    expect(state).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("maps an unavailable Auth server to INTERNAL", async () => {
    m.signInWithPassword.mockResolvedValue({ ok: false, reason: "unavailable" });
    const state = await signIn(IDLE, form(VALID));
    expect(state).toMatchObject({
      code: "INTERNAL",
      message: "Sign-in is unavailable right now. Try again shortly.",
    });
  });

  it("redirects an active user to the sanitised next path", async () => {
    await expect(signIn(IDLE, form(VALID))).rejects.toThrow("REDIRECT:/workspace?x=1");
  });

  it("never redirects off-site", async () => {
    await expect(signIn(IDLE, form({ ...VALID, next: "//evil.com" }))).rejects.toThrow(
      "REDIRECT:/workspace",
    );
    expect(m.redirect).toHaveBeenCalledWith("/workspace");
  });

  it("redirects a pending user to /pending-activation", async () => {
    m.readAuthState.mockResolvedValue({
      kind: "inactive",
      userId: "u",
      email: "pending@plan-markup.test",
      status: "pending",
    });
    await expect(signIn(IDLE, form(VALID))).rejects.toThrow("REDIRECT:/pending-activation");
  });

  it("returns INTERNAL when the limiter fails, and does not call Supabase", async () => {
    m.checkSignInRateLimit.mockRejectedValue(new Error("rpc down"));
    const state = await signIn(IDLE, form(VALID));
    expect(state).toEqual({
      status: "error",
      code: "INTERNAL",
      message: "Sign-in is unavailable right now. Try again shortly.",
    });
    expect(m.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it("ends the session and redirects to /sign-in", async () => {
    m.getAuthState.mockResolvedValue({ kind: "inactive", userId: "u", email: "e", status: "pending" });
    await expect(signOut()).rejects.toThrow("REDIRECT:/sign-in");
    expect(m.signOutCurrentSession).toHaveBeenCalledTimes(1);
  });

  it("only redirects when nobody is signed in", async () => {
    m.getAuthState.mockResolvedValue({ kind: "anonymous" });
    await expect(signOut()).rejects.toThrow("REDIRECT:/sign-in");
    expect(m.signOutCurrentSession).not.toHaveBeenCalled();
  });
});
