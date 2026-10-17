import { describe, expect, it } from "vitest";
import { findUnpinned } from "./check-pinned.mjs";

describe("findUnpinned", () => {
  it("accepts exact versions and prereleases", () => {
    expect(
      findUnpinned({
        dependencies: { a: "1.2.3" },
        devDependencies: { b: "0.0.1-beta.2" },
      }),
    ).toEqual([]);
  });

  it.each(["^1.2.3", "~1.2.3", "*", "x", ">=1.0.0", "<2.0.0", "1.x", "1 || 2", "latest", "next"])(
    "flags %s",
    (spec) => {
      expect(findUnpinned({ dependencies: { a: spec } })).toEqual([`dependencies: a@${spec}`]);
    },
  );

  it("checks all four sections and tolerates missing ones", () => {
    const result = findUnpinned({
      optionalDependencies: { o: "^1.0.0" },
      peerDependencies: { p: "~2.0.0" },
    });
    expect(result).toEqual(["optionalDependencies: o@^1.0.0", "peerDependencies: p@~2.0.0"]);
    expect(findUnpinned({})).toEqual([]);
  });
});
