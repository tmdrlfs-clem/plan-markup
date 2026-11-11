import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => {
    throw new Error("the admin client must not be used in this test");
  },
}));

import { checkSignInRateLimit, SIGN_IN_LIMITS, type Consume, type ConsumeArgs } from "./rate-limit";
import { rateLimitKeyHash } from "./rate-limit-key";

const IP = "203.0.113.7";
const EMAIL = "User@Plan-Markup.test";

function consumeWith(blocked: Partial<Record<ConsumeArgs["bucket"], number>>) {
  const calls: ConsumeArgs[] = [];
  const consume: Consume = async (args) => {
    calls.push(args);
    const retry = blocked[args.bucket];
    return retry === undefined
      ? { allowed: true, retryAfterSeconds: 0 }
      : { allowed: false, retryAfterSeconds: retry };
  };
  return { consume, calls };
}

describe("checkSignInRateLimit", () => {
  it("consumes both buckets with 64-hex hashes and the configured limits", async () => {
    const { consume, calls } = consumeWith({});
    await expect(checkSignInRateLimit({ ip: IP, email: EMAIL }, consume)).resolves.toEqual({
      allowed: true,
    });
    expect(calls.map((c) => c.bucket).sort()).toEqual(["sign_in_email", "sign_in_ip"]);
    for (const call of calls) {
      expect(call.keyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(call.keyHash).not.toContain(IP);
      expect(call.keyHash.toLowerCase()).not.toContain("user@plan-markup.test");
      const limit = SIGN_IN_LIMITS[call.bucket as keyof typeof SIGN_IN_LIMITS];
      expect(call.maxHits).toBe(limit.maxHits);
      expect(call.windowSeconds).toBe(limit.windowSeconds);
    }
    const emailCall = calls.find((c) => c.bucket === "sign_in_email");
    expect(emailCall?.keyHash).toBe(rateLimitKeyHash("sign_in_email", "user@plan-markup.test"));
    expect(SIGN_IN_LIMITS).toEqual({
      sign_in_ip: { maxHits: 30, windowSeconds: 900 },
      sign_in_email: { maxHits: 10, windowSeconds: 900 },
    });
  });

  it("blocks when the IP bucket is over the limit", async () => {
    const { consume } = consumeWith({ sign_in_ip: 120 });
    await expect(checkSignInRateLimit({ ip: IP, email: EMAIL }, consume)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 120,
    });
  });

  it("blocks when the email bucket is over the limit", async () => {
    const { consume } = consumeWith({ sign_in_email: 300 });
    await expect(checkSignInRateLimit({ ip: IP, email: EMAIL }, consume)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 300,
    });
  });

  it("reports the larger retry when both buckets are blocked", async () => {
    const { consume } = consumeWith({ sign_in_ip: 60, sign_in_email: 800 });
    await expect(checkSignInRateLimit({ ip: IP, email: EMAIL }, consume)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 800,
    });
  });

  it("rejects when consume throws (fail closed)", async () => {
    const consume: Consume = async () => {
      throw new Error("rpc down");
    };
    await expect(checkSignInRateLimit({ ip: IP, email: EMAIL }, consume)).rejects.toThrow("rpc down");
  });
});

describe("rateLimitKeyHash", () => {
  it("is deterministic and bucket-scoped", () => {
    expect(rateLimitKeyHash("sign_in_ip", IP)).toBe(rateLimitKeyHash("sign_in_ip", IP));
    expect(rateLimitKeyHash("sign_in_ip", IP)).not.toBe(rateLimitKeyHash("sign_in_email", IP));
    expect(rateLimitKeyHash("sign_in_ip", IP)).toMatch(/^[0-9a-f]{64}$/);
  });
});
