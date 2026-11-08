import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Story 9.4 (AR24, design §4.1): the oracle imports nothing from the placer,
// the prep step, Clipper or any other module: only its own files ("./...").
// The lint rule says the same; this test fails CI even if the lint config drifts.

const DIR = __dirname;
const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

function specifiers(source: string): string[] {
  return [...source.matchAll(IMPORT)].map((m) => m[1] ?? m[2] ?? m[3]);
}

describe("oracle independence (Story 9.4)", () => {
  const files = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

  it("has modules to check", () => {
    expect(files).toEqual(expect.arrayContaining(["check.ts", "index.ts", "kernel.ts"]));
  });

  it.each(files)("%s imports only ./ siblings", (file) => {
    const found = specifiers(readFileSync(path.join(DIR, file), "utf8"));
    for (const s of found) expect(s, `${file} imports ${s}`).toMatch(/^\.\/[\w-]+$/);
  });

  it("the matcher sees the imports it must refuse", () => {
    expect(specifiers('import { a } from "../placer/rows";\nexport { b } from "@/core/x";\nconst c = await import("clipper2-ts");')).toEqual([
      "../placer/rows",
      "@/core/x",
      "clipper2-ts",
    ]);
  });
});
