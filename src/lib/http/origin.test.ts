import { describe, expect, it, vi } from "vitest";
import { SAFE_MESSAGES } from "@/lib/result";
import { isAllowedOrigin, withOriginCheck } from "./origin";

type Row = [origin: string | null, headers: Record<string, string>, extra: string[] | undefined, expected: boolean];

const TABLE: Row[] = [
  ["http://localhost:3020", { host: "localhost:3020" }, undefined, true],
  ["https://app.example.com", { "x-forwarded-host": "app.example.com", host: "internal:3000" }, undefined, true],
  ["https://APP.example.com", { host: "app.example.com" }, undefined, true],
  ["https://evil.com", { host: "app.example.com" }, undefined, false],
  ["https://app.example.com.evil.com", { host: "app.example.com" }, undefined, false],
  ["http://localhost:3021", { host: "localhost:3020" }, undefined, false],
  [null, { host: "localhost:3020" }, undefined, false],
  ["null", { host: "localhost:3020" }, undefined, false],
  ["not a url", { host: "localhost:3020" }, undefined, false],
  ["ftp://localhost:3020", { host: "localhost:3020" }, undefined, false],
  ["https://a.example", { "x-forwarded-host": "a.example, b.example" }, undefined, true],
  ["https://proxy.example", { host: "app.example" }, ["proxy.example"], true],
];

function headersFor(origin: string | null, rest: Record<string, string>): Headers {
  const headers = new Headers(rest);
  if (origin !== null) headers.set("origin", origin);
  return headers;
}

describe("isAllowedOrigin", () => {
  it.each(TABLE)("origin %j with %j (extra %j) → %s", (origin, rest, extra, expected) => {
    expect(isAllowedOrigin(headersFor(origin, rest), extra)).toBe(expected);
  });

  it("rejects an over-long origin", () => {
    expect(isAllowedOrigin(headersFor(`http://${"a".repeat(2100)}`, { host: "localhost:3020" }))).toBe(false);
  });

  it("rejects when neither Host nor X-Forwarded-Host is present", () => {
    expect(isAllowedOrigin(headersFor("http://localhost:3020", {}))).toBe(false);
  });

  it("does not accept the second X-Forwarded-Host entry", () => {
    expect(isAllowedOrigin(headersFor("https://b.example", { "x-forwarded-host": "a.example, b.example" }))).toBe(false);
  });
});

describe("withOriginCheck", () => {
  it("returns 403 with the fixed body and never calls the handler", async () => {
    const handler = vi.fn(async () => new Response("ok"));
    const wrapped = withOriginCheck(handler);
    const res = await wrapped(
      new Request("http://localhost:3020/api/x", {
        method: "POST",
        headers: { origin: "https://evil.com", host: "localhost:3020" },
      }),
      {},
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, code: "FORBIDDEN", message: SAFE_MESSAGES.FORBIDDEN });
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler with the request and ctx when allowed", async () => {
    const handler = vi.fn(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
      const { id } = await ctx.params;
      return new Response(id, { status: 201 });
    });
    const wrapped = withOriginCheck(handler);
    const request = new Request("http://localhost:3020/api/x", {
      method: "POST",
      headers: { origin: "http://localhost:3020", host: "localhost:3020" },
    });
    const ctx = { params: Promise.resolve({ id: "abc" }) };
    const res = await wrapped(request, ctx);
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("abc");
    expect(handler).toHaveBeenCalledWith(request, ctx);
  });
});
