import { describe, expect, it } from "vitest";
import { mapStatusToEnv, mergeEnvFile } from "./supabase-env.mjs";

// Real `npx supabase status -o json` output from CLI 2.121.0 (2026-10-18), values redacted.
const STATUS_FIXTURE = {
  ANON_KEY: "eyJ-redacted-anon",
  API_URL: "http://127.0.0.1:56321",
  DB_URL: "postgresql://postgres:postgres@127.0.0.1:56322/postgres",
  GRAPHQL_URL: "http://127.0.0.1:56321/graphql/v1",
  JWT_SECRET: "redacted",
  PUBLISHABLE_KEY: "sb_publishable_redacted",
  REST_URL: "http://127.0.0.1:56321/rest/v1",
  S3_PROTOCOL_ACCESS_KEY_ID: "redacted",
  S3_PROTOCOL_ACCESS_KEY_SECRET: "redacted",
  S3_PROTOCOL_REGION: "local",
  SECRET_KEY: "sb_secret_redacted",
  SERVICE_ROLE_KEY: "eyJ-redacted-service",
  STORAGE_S3_URL: "http://127.0.0.1:56321/storage/v1/s3",
};

describe("mapStatusToEnv", () => {
  it("maps the real CLI output, preferring publishable and secret keys", () => {
    expect(mapStatusToEnv(STATUS_FIXTURE)).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:56321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_redacted",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_redacted",
    });
  });

  it("falls back to the legacy anon and service-role keys", () => {
    const legacy = { ...STATUS_FIXTURE };
    delete legacy.PUBLISHABLE_KEY;
    delete legacy.SECRET_KEY;
    expect(mapStatusToEnv(legacy)).toMatchObject({
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJ-redacted-anon",
      SUPABASE_SERVICE_ROLE_KEY: "eyJ-redacted-service",
    });
  });

  it("throws when a value is missing", () => {
    expect(() => mapStatusToEnv({ API_URL: "http://x" })).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});

describe("mergeEnvFile", () => {
  const vars = { A: "1", B: "2" };

  it("replaces existing keys and keeps other lines and comments", () => {
    expect(mergeEnvFile("# comment\nA=old\nOTHER=x\n", vars)).toBe("# comment\nA=1\nOTHER=x\nB=2\n");
  });

  it("creates the content for an empty file", () => {
    expect(mergeEnvFile("", vars)).toBe("A=1\nB=2\n");
  });

  it("keeps CRLF line endings", () => {
    expect(mergeEnvFile("A=old\r\nC=3\r\n", vars)).toBe("A=1\r\nC=3\r\nB=2\r\n");
  });

  it("drops duplicate definitions of a managed key", () => {
    expect(mergeEnvFile("A=old\nA=older\n", { A: "1" })).toBe("A=1\n");
  });

  it("does not touch commented-out keys", () => {
    expect(mergeEnvFile("# A=commented\n", { A: "1" })).toBe("# A=commented\nA=1\n");
  });
});
