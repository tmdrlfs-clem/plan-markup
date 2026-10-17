import { describe, expect, it } from "vitest";
import { generatePassword, isLocalUrl, parseArgs, validateInput } from "./admin-create-user.mjs";

describe("parseArgs", () => {
  it("reads email, name and flags", () => {
    expect(parseArgs(["--email", "a@b.co", "--name", "Pilot One", "--yes"])).toEqual({
      email: "a@b.co",
      name: "Pilot One",
      passwordStdin: false,
      yes: true,
    });
    expect(parseArgs(["--email", "a@b.co", "--password-stdin"]).passwordStdin).toBe(true);
  });

  it("rejects unknown arguments and missing values", () => {
    expect(() => parseArgs(["--admin"])).toThrow(/Unknown argument/);
    expect(() => parseArgs(["--email"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--email", "--yes"])).toThrow(/needs a value/);
  });
});

describe("validateInput", () => {
  it("normalises email and name", () => {
    expect(validateInput({ email: "  Pilot@Plan-Markup.TEST ", name: "  Pilot One " })).toEqual({
      ok: true,
      email: "pilot@plan-markup.test",
      name: "Pilot One",
      password: undefined,
    });
  });

  it.each([
    [{}, "--email is required."],
    [{ email: "not-an-email" }, "--email is not a valid email address."],
    [{ email: `${"a".repeat(250)}@b.co` }, "--email is not a valid email address."],
    [{ email: "a@b.co", name: "x".repeat(101) }, "--name must be at most 100 characters."],
    [{ email: "a@b.co", password: "short" }, "The password must be 12 to 128 characters."],
    [{ email: "a@b.co", password: "x".repeat(129) }, "The password must be 12 to 128 characters."],
  ])("rejects %j", (input, message) => {
    const result = validateInput(input);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(message);
  });

  it("accepts a 100-character name and a 12-character password", () => {
    const result = validateInput({ email: "a@b.co", name: "x".repeat(100), password: "x".repeat(12) });
    expect(result.ok).toBe(true);
  });
});

describe("isLocalUrl", () => {
  it.each([
    ["http://127.0.0.1:56321", true],
    ["http://localhost:56321", true],
    ["https://abc.supabase.co", false],
    ["http://127.0.0.1.evil.com", false],
    ["not a url", false],
  ])("%s -> %s", (url, expected) => {
    expect(isLocalUrl(url)).toBe(expected);
  });
});

describe("generatePassword", () => {
  it("returns 24 URL-safe characters and differs per call", () => {
    const a = generatePassword();
    expect(a).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(generatePassword()).not.toBe(a);
  });
});
