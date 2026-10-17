import { describe, expect, it } from "vitest";
import { cspModeFor, MARKETING_PATHS } from "./route-policy";

describe("route policy", () => {
  it("has no marketing paths yet (Story 13.1)", () => {
    expect(MARKETING_PATHS.size).toBe(0);
  });

  it.each(["/", "/sign-in", "/workspace", "/pending-activation", "/admin", "/unknown"])(
    "%s uses the nonce CSP",
    (path) => {
      expect(cspModeFor(path)).toBe("nonce");
    },
  );
});
