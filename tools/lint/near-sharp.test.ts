// Guards the near-sharp design rules: radius 2-4 px, hard shadows, no blur.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx|css)$/.test(entry.name) ? [full] : [];
  });
}

export const RULES: { name: string; pattern: RegExp }[] = [
  {
    name: "rounded-xl and larger (only rounded, -sm, -md, -lg, -none, -full are allowed)",
    pattern: /\brounded(?:-[a-z]{1,2})?-(?:xl|2xl|3xl|4xl)\b/,
  },
  {
    name: "soft shadow utility (use shadow-1/2/3)",
    pattern: /\bshadow-(?:xs|sm|md|lg|xl|2xl|inner)\b/,
  },
  {
    name: "blur utility",
    pattern: /(?:^|[\s"'`:])(?:backdrop-)?blur(?:-[\w[\]./%-]+)?(?=[\s"'`]|$)/,
  },
  {
    // box-shadow: <x> <y> <blur> ... where blur is a non-zero length
    name: "box-shadow with non-zero blur",
    pattern:
      /box-shadow\s*:\s*(?:inset\s+)?-?[\d.]+(?:px)?\s+-?[\d.]+(?:px)?\s+(?!0(?:px)?\b)[\d.]+px/i,
  },
  {
    name: "arbitrary shadow with blur",
    pattern: /\bshadow-\[(?:inset_)?-?[\d.]+(?:px)?_-?[\d.]+(?:px)?_(?!0(?:px)?[_\]])[\d.]+px/,
  },
];

export function findViolations(source: string): string[] {
  return RULES.filter((r) => r.pattern.test(source)).map((r) => r.name);
}

describe("near-sharp guard", () => {
  it("flags the off-token styles it is meant to catch", () => {
    expect(findViolations('className="rounded-xl"')).toHaveLength(1);
    expect(findViolations('className="sm:rounded-2xl p-2"')).toHaveLength(1);
    expect(findViolations('className="shadow-md"')).toHaveLength(1);
    expect(findViolations('className="backdrop-blur-sm"')).toHaveLength(1);
    expect(findViolations('className="p-2 blur-md"')).toHaveLength(1);
    expect(findViolations("a { box-shadow: 0 4px 12px #000; }")).toHaveLength(1);
    expect(findViolations('className="shadow-[0_4px_12px_#000]"')).toHaveLength(1);
  });

  it("allows the near-sharp vocabulary", () => {
    const ok = [
      'className="rounded rounded-sm rounded-md rounded-lg rounded-none rounded-full"',
      'className="shadow-1 shadow-2 shadow-3"',
      "a { box-shadow: 2px 2px 0 #000; }",
      "a { box-shadow: 0 0 0 2px #000, 0 0 0 4px #fff; }",
      'className="shadow-[2px_2px_0_#000]"',
    ];
    for (const source of ok) expect(findViolations(source), source).toEqual([]);
  });

  it("finds no off-token styles under src/", () => {
    const files = walk(SRC).filter((f) => !/\.test\.(ts|tsx)$/.test(f));
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const name of findViolations(source)) {
        offenders.push(`${relative(ROOT, file)}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
