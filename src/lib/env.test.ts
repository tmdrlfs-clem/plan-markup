import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
};

describe("parseEnv", () => {
  it("parses valid input and leaves optional variables undefined", () => {
    const env = parseEnv({ ...valid, NEXT_PUBLIC_LOG_LEVEL: "warn" });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(valid.NEXT_PUBLIC_SUPABASE_URL);
    expect(env.NEXT_PUBLIC_LOG_LEVEL).toBe("warn");
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  it("treats empty optional variables as unset", () => {
    const env = parseEnv({ ...valid, NEXT_PUBLIC_SENTRY_DSN: "" });
    expect(env.NEXT_PUBLIC_SENTRY_DSN).toBeUndefined();
  });

  it("fails naming a missing NEXT_PUBLIC_SUPABASE_URL", () => {
    expect(() =>
      parseEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("fails when the URL is not a URL", () => {
    expect(() =>
      parseEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "not a url" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("lists every invalid variable in one error", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_LOG_LEVEL: "loud" })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL[\s\S]*NEXT_PUBLIC_SUPABASE_ANON_KEY[\s\S]*NEXT_PUBLIC_LOG_LEVEL/,
    );
  });

  it("leaves the optional Sentry variables undefined when empty", () => {
    const env = parseEnv({
      ...valid,
      NEXT_PUBLIC_SENTRY_ENVIRONMENT: "",
      SENTRY_ORG: "",
      SENTRY_PROJECT: "",
    });
    expect(env.NEXT_PUBLIC_SENTRY_ENVIRONMENT).toBeUndefined();
    expect(env.SENTRY_ORG).toBeUndefined();
    expect(env.SENTRY_PROJECT).toBeUndefined();
  });

  it("keeps the optional Sentry variables when present", () => {
    const env = parseEnv({
      ...valid,
      NEXT_PUBLIC_SENTRY_ENVIRONMENT: "preview",
      SENTRY_ORG: "acme",
      SENTRY_PROJECT: "plan-markup",
    });
    expect(env.NEXT_PUBLIC_SENTRY_ENVIRONMENT).toBe("preview");
    expect(env.SENTRY_ORG).toBe("acme");
    expect(env.SENTRY_PROJECT).toBe("plan-markup");
  });

  it("rejects a Sentry environment longer than 64 characters", () => {
    expect(() =>
      parseEnv({ ...valid, NEXT_PUBLIC_SENTRY_ENVIRONMENT: "x".repeat(65) }),
    ).toThrow(/NEXT_PUBLIC_SENTRY_ENVIRONMENT/);
  });
});
