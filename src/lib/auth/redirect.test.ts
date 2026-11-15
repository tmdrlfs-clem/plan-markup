import { describe, expect, it } from "vitest";
import { ALLOWED_NEXT_PREFIXES, DEFAULT_AFTER_SIGN_IN, sanitizeNextPath } from "./redirect";

const D = "/workspace";

describe("sanitizeNextPath (NFR19)", () => {
  it("defaults to /workspace and allowlists /workspace and /admin only", () => {
    expect(DEFAULT_AFTER_SIGN_IN).toBe("/workspace");
    expect(ALLOWED_NEXT_PREFIXES).toEqual(["/workspace", "/admin"]);
    // Story 10.4: the admin area (a 404 there for anyone but the platform admin).
    expect(sanitizeNextPath("/admin/users?status=all")).toBe("/admin/users?status=all");
    expect(sanitizeNextPath("/administrator")).toBe("/workspace");
  });

  it.each<[unknown, string]>([
    [undefined, D],
    [null, D],
    [42, D],
    ["", D],
    ["/workspace", "/workspace"],
    ["/workspace?tab=recent#x", "/workspace?tab=recent#x"],
    ["/workspace/sub/page", "/workspace/sub/page"],
    ["/workspacex", D],
    ["/sign-in", D],
    ["/pending-activation", D],
    ["/", D],
    ["//evil.com", D],
    ["///evil.com", D],
    ["//evil.com/workspace", D],
    ["https://evil.com", D],
    ["http://evil.com/workspace", D],
    ["javascript:alert(1)", D],
    ["/\\evil.com", D],
    ["\\/evil.com", D],
    ["/workspace\\..\\evil", D],
    ["%2F%2Fevil.com", D],
    ["/%2F%2Fevil.com", D],
    ["/%2fevil.com", D],
    ["/%5Cevil.com", D],
    ["/%5cevil.com", D],
    ["%252F%252Fevil.com", D],
    ["/%252F%252Fevil.com", D],
    ["/\tevil.com", D],
    ["/\n/evil.com", D],
    [" /workspace", D],
    ["/workspace/%2E%2E/%2E%2E/evil", D],
    ["/%E0%A4%A", D],
    [`/workspace/${"a".repeat(600)}`, D],
  ])("%j -> %s", (input, expected) => {
    expect(sanitizeNextPath(input)).toBe(expected);
  });
});
