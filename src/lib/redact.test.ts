import { afterEach, describe, expect, it, vi } from "vitest";
import { isUuid, redactError, redactFields, scrubText } from "./redact";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("scrubText", () => {
  it.each([
    ["mail a@b.co now", "mail [email] now"],
    ["encoded a%40b.co", "encoded [email]"],
    ["open Level2.PDF failed", "open [file] failed"],
    ["file C:\\x\\plan.btx", "file C:\\x\\[file]"],
    ["Key (name)=(Level 2) already exists", "Key ([redacted])=([redacted]) already exists"],
    ["auth Bearer abc.def-123 sent", "auth [token] sent"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig end", "jwt [token] end"],
    ["key sb_secret_ABC123 and sb_publishable_x-y", "key [key] and [key]"],
    ["GET http://h:1/rest/v1/p?select=*&x=1 failed", "GET http://h:1/rest/v1/p failed"],
    ["nav /d/abc?x=1#frag done", "nav /d/abc done"],
    ["page https://a.example/x#top", "page https://a.example/x"],
  ])("%s", (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it("scrubs a unique violation that names a file and an email", () => {
    const out = scrubText("duplicate key value Key (name)=(Level 2 Fire.pdf) already exists for user a@b.co");
    expect(out).not.toContain("Level 2 Fire.pdf");
    expect(out).not.toContain("a@b.co");
  });

  it("caps the length", () => {
    expect(scrubText("x".repeat(600))).toHaveLength(500);
    expect(scrubText("x".repeat(600), 10)).toHaveLength(10);
  });

  it("leaves plain text alone", () => {
    expect(scrubText("rate limiter unavailable (status 503)")).toBe("rate limiter unavailable (status 503)");
  });
});

describe("isUuid", () => {
  it("accepts non-RFC UUIDs and rejects others", () => {
    expect(isUuid("00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isUuid("ABCDEF01-2345-6789-abcd-ef0123456789")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});

describe("redactFields", () => {
  it("keeps only safe keys in clear text", () => {
    const out = redactFields({ email: "a@b.co", password: "x", token: "t", fileName: "L2.pdf", status: 429 });
    expect(out).toEqual({
      email: "[redacted]",
      password: "[redacted]",
      token: "[redacted]",
      fileName: "[redacted]",
      status: 429,
    });
  });

  it.each(["apiKey", "authorization", "cookie", "sessionId", "name", "content", "text", "body", "note", "comment", "secret"])(
    "redacts %s",
    (key) => {
      expect(redactFields({ [key]: "v" })[key]).toBe("[redacted]");
    },
  );

  it("keeps safe keys and scrubs other strings", () => {
    const out = redactFields({ code: "over_request_rate_limit", count: 3, durationMs: 12, route: "/d/x?q=a@b.co" });
    expect(out).toEqual({ code: "over_request_rate_limit", count: 3, durationMs: 12, route: "/d/x" });
  });

  it("keeps a UUID drawingId and redacts anything else", () => {
    expect(redactFields({ drawingId: "00000000-0000-4000-8000-000000000001" }).drawingId).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(redactFields({ drawingId: "Level 2.pdf" }).drawingId).toBe("[redacted]");
  });

  it("never stringifies objects", () => {
    const out = redactFields({ detail: { text: "Riser note" } as unknown as string });
    expect(JSON.stringify(out)).not.toContain("Riser");
  });

  it("caps strings at 200 characters", () => {
    expect(redactFields({ detail: "y".repeat(300) }).detail).toHaveLength(200);
  });
});

describe("redactError", () => {
  it("reduces an Error to name and scrubbed message, no stack in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const out = redactError(new TypeError("cannot open L2.pdf for a@b.co"));
    expect(out).toEqual({ name: "TypeError", message: "cannot open [file] for [email]" });
  });

  it("keeps a scrubbed stack outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    const out = redactError(new Error("for a@b.co"));
    expect(out.stack).toBeDefined();
    expect(out.stack).not.toContain("a@b.co");
  });
});

describe("scrubText with URLs", () => {
  it.each([
    ["see https://app.example/d/AbCtoken123?email=a@b.co now", "see https://app.example/d/[redacted] now"],
    ["dsn https://public@o0.ingest.sentry.io/0", "dsn https://o0.ingest.sentry.io/[redacted]"],
    [
      "at f (http://localhost:3020/_next/static/chunks/app-1.js:1:2)",
      "at f (http://localhost:3020/_next/static/chunks/app-1.js:1:2)",
    ],
    ["at q (/app/src/lib/db/x.ts:1:1)", "at q (/app/src/lib/db/x.ts:1:1)"],
  ])("%s", (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });
});
