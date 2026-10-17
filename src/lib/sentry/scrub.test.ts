import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { isSafeDrawingId, scrubBreadcrumb, scrubEvent, scrubText, scrubUrl } from "./scrub";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const DRAWING_ID = "11111111-2222-4333-8444-555555555555";

function dirtyEvent(): ErrorEvent {
  return {
    type: undefined,
    event_id: "abc123",
    level: "error",
    environment: "production",
    server_name: "host-a@b.co",
    message: "failed for a@b.co",
    request: {
      method: "POST",
      url: "https://app.example/d/AbCtoken123/Level%202%20Fire.pdf?email=a@b.co#x",
      query_string: "email=a@b.co",
      cookies: { "sb-auth-token": "eyJhbGciOi" },
      headers: {
        authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig",
        cookie: "sb-auth-token=eyJhbGciOi",
        "user-agent": "Mozilla/5.0",
      },
      data: '{"text":"Riser note"}',
      env: { REMOTE_ADDR: "1.2.3.4" },
    },
    user: { id: USER_ID, email: "a@b.co", ip_address: "1.2.3.4", username: "x" },
    tags: { drawing_id: DRAWING_ID, file_name: "L2.pdf", worker: "engine", random: "x" },
    extra: { markupText: "Riser note" },
    contexts: {
      drawing: { title: "Riser note" },
      nextjs: { route: "/d/AbCtoken123" },
      browser: { name: "Chrome" },
      trace: { trace_id: "t", span_id: "s", data: { url: "https://x/?email=a@b.co" } },
      react: { componentStack: "at Canvas", props: "Riser note" },
    },
    exception: {
      values: [
        {
          type: "PostgresError",
          value: "duplicate key value violates unique constraint Key (name)=(Level 2 Fire.pdf) already exists for user a@b.co",
          mechanism: { type: "onerror", handled: false, data: { text: "Riser note" } },
          stacktrace: {
            frames: [
              {
                filename: "https://app.example/_next/static/chunks/app-123.js?v=a@b.co",
                abs_path: "https://app.example/d/AbCtoken123?x=1",
                function: "render",
                lineno: 1,
                vars: { text: "Riser note" },
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: [
      { category: "console", message: "Riser note" },
      { category: "ui.click", message: 'div[aria-label="Riser note"]' },
      {
        category: "fetch",
        type: "http",
        data: {
          method: "GET",
          status_code: 200,
          url: "http://127.0.0.1:56321/rest/v1/profiles?select=*&email=eq.a%40b.co",
          body: "Riser note",
        },
      },
      { category: "navigation", data: { from: "/workspace", to: "/d/AbCtoken123?x=1" } },
    ],
  } as unknown as ErrorEvent;
}

const FORBIDDEN = [
  "a@b.co",
  "a%40b.co",
  "Level 2 Fire.pdf",
  "Level%202",
  "L2.pdf",
  "Riser note",
  "AbCtoken123",
  "eyJ",
  "1.2.3.4",
  "email=",
  "select=",
  "#x",
];

describe("scrubEvent", () => {
  it("removes every forbidden string from the dirty event", () => {
    const json = JSON.stringify(scrubEvent(dirtyEvent()));
    for (const s of FORBIDDEN) expect(json, s).not.toContain(s);
  });

  it("keeps the allowlisted data", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deep assertions on a loose event shape
    const out = scrubEvent(dirtyEvent()) as unknown as Record<string, any>;
    expect(out.tags).toEqual({ drawing_id: DRAWING_ID, worker: "engine" });
    expect(out.user).toEqual({ id: USER_ID });
    expect(out.request).toEqual({
      method: "POST",
      url: "https://app.example/d/[redacted]/[redacted]",
      headers: { "user-agent": "Mozilla/5.0" },
    });
    expect(out.exception.values[0].type).toBe("PostgresError");
    expect(out.exception.values[0].mechanism).toEqual({ type: "onerror", handled: false });
    const frame = out.exception.values[0].stacktrace.frames[0];
    expect(frame.vars).toBeUndefined();
    expect(frame.filename).toBe("https://app.example/_next/static/chunks/app-123.js");
    expect(frame.abs_path).toBe("https://app.example/d/[redacted]");
    expect(out.contexts).toEqual({
      browser: { name: "Chrome" },
      trace: { trace_id: "t", span_id: "s" },
      react: { componentStack: "at Canvas" },
    });
    expect(out.extra).toBeUndefined();
    expect(out.server_name).toBeUndefined();
    expect(out.breadcrumbs).toEqual([
      {
        category: "fetch",
        type: "http",
        data: { method: "GET", status_code: 200, url: "http://127.0.0.1:56321/rest/v1/profiles" },
      },
      { category: "navigation", data: { from: "/workspace", to: "/d/[redacted]" } },
    ]);
  });

  it("does not mutate the input", () => {
    const input = dirtyEvent();
    const before = JSON.stringify(input);
    scrubEvent(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("drops a non-UUID drawing_id and an invalid worker", () => {
    const event = { tags: { drawing_id: "Level 2.pdf", worker: "evil", log_event: "auth.rate_limiter_failed" } };
    expect(scrubEvent(event as unknown as ErrorEvent).tags).toEqual({ log_event: "auth.rate_limiter_failed" });
  });

  it("drops a log_event tag that is not a constant event name", () => {
    const event = { tags: { log_event: "failed for a@b.co" } };
    expect(scrubEvent(event as unknown as ErrorEvent).tags).toEqual({});
  });

  it("drops a non-UUID user id", () => {
    expect(scrubEvent({ user: { id: "a@b.co" } } as unknown as ErrorEvent).user).toBeUndefined();
  });

  it("caps a 600-character message at 500", () => {
    expect(scrubEvent({ message: "m".repeat(600) } as unknown as ErrorEvent).message).toHaveLength(500);
  });

  it("scrubs the transaction path but keeps route params", () => {
    const out = scrubEvent({ transaction: "GET /d/[drawingId]/AbCtoken123?x=1" } as unknown as ErrorEvent);
    expect(out.transaction).toBe("GET /d/[drawingId]/[redacted]");
  });
});

describe("scrubUrl", () => {
  it.each([
    ["https://app.example/d/AbCtoken123/x.pdf?e=1#f", "https://app.example/d/[redacted]/[redacted]"],
    [`https://app.example/d/${DRAWING_ID}`, `https://app.example/d/${DRAWING_ID}`],
    ["/rest/v1/profiles?select=*", "/rest/v1/profiles"],
    ["/workspace", "/workspace"],
    ["not a url", "[redacted-url]"],
    ["", "[redacted-url]"],
    ["//evil.example/x", "[redacted-url]"],
    ["javascript:alert(1)", "[redacted-url]"],
    ["http://[bad", "[redacted-url]"],
  ])("%s → %s", (input, expected) => {
    expect(scrubUrl(input)).toBe(expected);
  });
});

describe("scrubBreadcrumb", () => {
  it.each(["console", "ui.click", "ui.input", "sentry.event", "custom", ""])("drops %s", (category) => {
    expect(scrubBreadcrumb({ category, message: "Riser note" })).toBeNull();
  });

  it("keeps an xhr crumb with a scrubbed message", () => {
    const crumb: Breadcrumb = { category: "xhr", message: "POST /d/AbCtoken123?x=a@b.co", data: { method: "POST" } };
    expect(scrubBreadcrumb(crumb)).toEqual({ category: "xhr", message: "POST /d/AbCtoken123", data: { method: "POST" } });
  });
});

describe("scrubText", () => {
  it.each([
    ["a@b.co", "[email]"],
    ["Fire.pdf", "[file]"],
    ["Key (name)=(x) x", "Key ([redacted])=([redacted]) x"],
    ["Bearer abc", "[token]"],
    ["eyJabc.def", "[token]"],
    ["sb_secret_x", "[key]"],
    ["https://h/p?q=1", "https://h/p"],
  ])("%s → %s", (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });
});

describe("isSafeDrawingId", () => {
  it("accepts UUIDs only", () => {
    expect(isSafeDrawingId(DRAWING_ID)).toBe(true);
    expect(isSafeDrawingId("x")).toBe(false);
  });
});
