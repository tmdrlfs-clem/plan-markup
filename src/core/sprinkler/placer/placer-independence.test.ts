import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Story 9.5 (AR24): the placer never imports the oracle (nor anything outside its folder), so a
// placer bug cannot leak into the check that is meant to catch it. The lint rule says the same;
// this test fails CI even if the lint config drifts.

const DIR = __dirname;
const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

function specifiers(source: string): string[] {
  return [...source.matchAll(IMPORT)].map((m) => m[1] ?? m[2] ?? m[3]);
}

describe("placer independence (Story 9.5)", () => {
  const files = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

  it("has modules to check", () => {
    expect(files).toEqual(expect.arrayContaining(["geometry.ts", "index.ts", "place-zone.ts"]));
  });

  it.each(files)("%s imports only ./ siblings", (file) => {
    const found = specifiers(readFileSync(path.join(DIR, file), "utf8"));
    for (const s of found) expect(s, `${file} imports ${s}`).toMatch(/^\.\/[\w-]+$/);
  });

  it("the oracle's folder never mentions the placer, and vice versa", () => {
    const oracle = path.join(DIR, "..", "oracle");
    for (const f of readdirSync(oracle).filter((x) => /\.tsx?$/.test(x) && !/\.test\.tsx?$/.test(x))) {
      expect(specifiers(readFileSync(path.join(oracle, f), "utf8")).some((s) => s.includes("placer"))).toBe(false);
    }
    for (const f of files) expect(specifiers(readFileSync(path.join(DIR, f), "utf8")).some((s) => s.includes("oracle"))).toBe(false);
  });
});
