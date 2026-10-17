import { describe, expect, it } from "vitest";
import { getClientIp } from "./client-ip";

describe("getClientIp", () => {
  it("prefers x-real-ip", () => {
    const h = new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" });
    expect(getClientIp(h)).toBe("203.0.113.7");
  });

  it("uses the first x-forwarded-for entry", () => {
    const h = new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1, 10.0.0.2" });
    expect(getClientIp(h)).toBe("198.51.100.1");
  });

  it("trims whitespace", () => {
    expect(getClientIp(new Headers({ "x-real-ip": "  203.0.113.7  " }))).toBe("203.0.113.7");
    expect(getClientIp(new Headers({ "x-forwarded-for": "   198.51.100.1 ,x" }))).toBe("198.51.100.1");
  });

  it("truncates over-long values to 64 characters", () => {
    expect(getClientIp(new Headers({ "x-real-ip": "a".repeat(200) }))).toBe("a".repeat(64));
  });

  it("returns unknown when no header is present", () => {
    expect(getClientIp(new Headers())).toBe("unknown");
    expect(getClientIp(new Headers({ "x-forwarded-for": " , " }))).toBe("unknown");
  });
});
