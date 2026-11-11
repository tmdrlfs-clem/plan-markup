import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({ auth: { verifyOtp: m.verifyOtp } }) }));

import { confirmLink } from "./confirm-actions";
import { landing, parseLink } from "./confirm-link";

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.verifyOtp.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
});

describe("parseLink", () => {
  it("accepts our four link kinds and nothing else", () => {
    expect(parseLink({ token_hash: "pkce_abc", type: "recovery" })).toEqual({ tokenHash: "pkce_abc", type: "recovery" });
    expect(parseLink({ token_hash: "abc", type: "magiclink" })).toBeNull();
    expect(parseLink({ token_hash: "", type: "email" })).toBeNull();
    expect(parseLink({ token_hash: "a".repeat(513), type: "email" })).toBeNull();
    expect(parseLink({ token_hash: ["a", "b"], type: "email" })).toBeNull();
    expect(parseLink({})).toBeNull();
  });

  it("leads each kind to its page", () => {
    expect(landing("email", false)).toBe("/pending-activation");
    expect(landing("recovery", false)).toBe("/reset-password");
    expect(landing("email_change", true)).toBe("/email-change?step=other");
    expect(landing("email_change", false)).toBe("/email-change?step=done");
  });
});

describe("confirmLink", () => {
  it("uses the token and goes where the link leads", async () => {
    await expect(confirmLink(form({ token_hash: "t", type: "email" }))).rejects.toThrow("REDIRECT:/pending-activation");
    expect(m.verifyOtp).toHaveBeenCalledWith({ token_hash: "t", type: "email" });
    await expect(confirmLink(form({ token_hash: "t", type: "recovery" }))).rejects.toThrow("REDIRECT:/reset-password");
  });

  it("treats the first email-change link (no user in the answer) as 'one more to open'", async () => {
    m.verifyOtp.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(confirmLink(form({ token_hash: "t", type: "email_change" }))).rejects.toThrow("REDIRECT:/email-change?step=other");
    await expect(confirmLink(form({ token_hash: "t", type: "email_change" }))).rejects.toThrow("REDIRECT:/email-change?step=done");
  });

  it("sends a bad, used or unknown link to sign-in without calling Auth for bad input", async () => {
    await expect(confirmLink(form({ token_hash: "t", type: "magiclink" }))).rejects.toThrow("REDIRECT:/sign-in?link=invalid");
    expect(m.verifyOtp).not.toHaveBeenCalled();
    m.verifyOtp.mockResolvedValueOnce({ data: { user: null }, error: { status: 403, code: "otp_expired" } });
    await expect(confirmLink(form({ token_hash: "t", type: "email" }))).rejects.toThrow("REDIRECT:/sign-in?link=invalid");
  });
});
