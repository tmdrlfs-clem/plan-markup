import { describe, expect, it } from "vitest";
import { ACCEPTED, failing, highAdvisories } from "./audit-runtime.mjs";

const report = {
  vulnerabilities: {
    picomatch: {
      via: [
        {
          url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
          name: "picomatch",
          title: "ReDoS",
          severity: "high",
        },
        {
          url: "https://github.com/advisories/GHSA-low1",
          name: "picomatch",
          title: "minor",
          severity: "moderate",
        },
      ],
    },
    "@sentry/nextjs": { via: ["picomatch"] },
    other: {
      via: [
        {
          url: "https://github.com/advisories/GHSA-crit",
          name: "other",
          title: "bad",
          severity: "critical",
        },
      ],
    },
  },
};

describe("highAdvisories", () => {
  it("keeps high and critical advisories once each, by GHSA id", () => {
    expect([...highAdvisories(report).keys()]).toEqual([
      "GHSA-fc5q-39xc-vjpf",
      "GHSA-crit",
    ]);
  });
});

describe("failing", () => {
  const ids = highAdvisories(report);
  it("lets an accepted advisory pass until its review date, and fails every other", () => {
    expect(failing(ids, "2026-11-19").map(([id]) => id)).toEqual(["GHSA-crit"]);
  });
  it("fails the accepted advisory again after its review date", () => {
    const after = "2099-01-01";
    expect(failing(ids, after).map(([id]) => id)).toEqual([
      "GHSA-fc5q-39xc-vjpf",
      "GHSA-crit",
    ]);
  });
  it("gives every accepted advisory a reason and a review date", () => {
    for (const a of Object.values(ACCEPTED)) {
      expect(a.reason.length).toBeGreaterThan(20);
      expect(a.review).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
