import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type FakeUser = { id: string; email?: string; user_metadata?: unknown; app_metadata?: unknown };

const fake = vi.hoisted(() => ({
  user: null as FakeUser | null,
  getUserError: null as { message: string } | null,
  profile: null as Record<string, unknown> | null,
  profileError: null as { code: string } | null,
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: fake.redirect }));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: {
      getSession: () => {
        throw new Error("getSession must never be called");
      },
      getUser: async () => ({
        data: { user: fake.getUserError ? null : fake.user },
        error: fake.getUserError,
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: fake.profile, error: fake.profileError }),
        }),
      }),
    }),
  }),
}));

import { getAuthUser, readAuthState, requireActiveUser } from "./get-auth-user";

const ID = "00000000-0000-4000-8000-00000000000b";
const EVIL_USER: FakeUser = {
  id: ID,
  email: "user@plan-markup.test",
  user_metadata: { name: "Evil", is_platform_admin: true },
  app_metadata: { role: "admin" },
};

function profile(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: ID,
    name: "Dev User",
    email: "user@plan-markup.test",
    status,
    is_platform_admin: false,
    theme: "daylight",
    ...extra,
  };
}

beforeEach(() => {
  fake.user = null;
  fake.getUserError = null;
  fake.profile = null;
  fake.profileError = null;
  fake.redirect.mockClear();
});

describe("readAuthState / getAuthUser", () => {
  it("is anonymous without a user", async () => {
    await expect(readAuthState()).resolves.toEqual({ kind: "anonymous" });
    await expect(getAuthUser()).resolves.toBeNull();
  });

  it("is anonymous when getUser() errors", async () => {
    fake.user = EVIL_USER;
    fake.getUserError = { message: "invalid JWT" };
    await expect(readAuthState()).resolves.toEqual({ kind: "anonymous" });
  });

  it("builds the user from the profile and ignores user_metadata and app_metadata", async () => {
    fake.user = EVIL_USER;
    fake.profile = profile("active");
    await expect(readAuthState()).resolves.toEqual({
      kind: "active",
      user: { id: ID, email: "user@plan-markup.test", name: "Dev User", isPlatformAdmin: false, theme: "daylight" },
    });
  });

  it("a profile row without the theme column (code deployed before the migration) still signs in, as Blueprint (review T2)", async () => {
    fake.user = EVIL_USER;
    const row: Record<string, unknown> = profile("active");
    delete row.theme;
    fake.profile = row as ReturnType<typeof profile>;
    await expect(getAuthUser()).resolves.toMatchObject({ id: ID, theme: "blueprint" });
  });

  it("an unknown stored theme reads as the default (Story 3.8)", async () => {
    fake.user = EVIL_USER;
    fake.profile = profile("active", { theme: "neon" });
    await expect(getAuthUser()).resolves.toMatchObject({ theme: "blueprint" });
  });

  it("is inactive/pending for a pending profile, and getAuthUser() is null", async () => {
    fake.user = EVIL_USER;
    fake.profile = profile("pending");
    await expect(readAuthState()).resolves.toEqual({
      kind: "inactive",
      userId: ID,
      email: "user@plan-markup.test",
      status: "pending",
    });
    await expect(getAuthUser()).resolves.toBeNull();
  });

  it("is inactive/deactivated for a deactivated profile", async () => {
    fake.user = EVIL_USER;
    fake.profile = profile("deactivated");
    await expect(readAuthState()).resolves.toMatchObject({ kind: "inactive", status: "deactivated" });
  });

  it("is inactive/pending when no profile row exists", async () => {
    fake.user = EVIL_USER;
    await expect(readAuthState()).resolves.toEqual({
      kind: "inactive",
      userId: ID,
      email: "user@plan-markup.test",
      status: "pending",
    });
  });

  it("throws on a profile query error (fail closed)", async () => {
    fake.user = EVIL_USER;
    fake.profileError = { code: "42501" };
    await expect(readAuthState()).rejects.toThrow();
  });
});

describe("requireActiveUser", () => {
  // getAuthState is React-cached; outside a React request each call reads afresh.
  it("redirects anonymous users to sign-in with the next path", async () => {
    await expect(requireActiveUser("/workspace")).rejects.toThrow("REDIRECT:");
    expect(fake.redirect).toHaveBeenCalledWith("/sign-in?next=%2Fworkspace");
  });

  it("redirects anonymous users to plain /sign-in without a path", async () => {
    await expect(requireActiveUser()).rejects.toThrow("REDIRECT:");
    expect(fake.redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("redirects inactive users to /pending-activation", async () => {
    fake.user = EVIL_USER;
    fake.profile = profile("pending");
    await expect(requireActiveUser("/workspace")).rejects.toThrow("REDIRECT:");
    expect(fake.redirect).toHaveBeenCalledWith("/pending-activation");
  });

  it("returns the active user", async () => {
    fake.user = EVIL_USER;
    fake.profile = profile("active", { is_platform_admin: true });
    await expect(requireActiveUser("/workspace")).resolves.toMatchObject({ isPlatformAdmin: true });
    expect(fake.redirect).not.toHaveBeenCalled();
  });
});
