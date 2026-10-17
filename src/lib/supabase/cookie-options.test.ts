import { describe, expect, it } from "vitest";
import { AUTH_COOKIE_MAX_AGE, AUTH_COOKIE_OPTIONS, withAuthCookieOptions } from "./cookie-options";

describe("auth cookie options", () => {
  it("are HttpOnly, Secure, SameSite=Lax, path / and 30 days", () => {
    expect(AUTH_COOKIE_OPTIONS).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 2_592_000,
    });
  });

  it("override the library's 400-day maxAge and httpOnly: false", () => {
    expect(
      withAuthCookieOptions({ httpOnly: false, secure: false, sameSite: "none", maxAge: 34_560_000 }),
    ).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: AUTH_COOKIE_MAX_AGE });
  });

  it("keep removals as removals", () => {
    expect(withAuthCookieOptions({ maxAge: 0 }).maxAge).toBe(0);
  });

  it("default maxAge when none is given", () => {
    expect(withAuthCookieOptions(undefined).maxAge).toBe(AUTH_COOKIE_MAX_AGE);
  });
});
