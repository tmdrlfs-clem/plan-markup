// Story 3.8 AC 2: no hard-coded colours in canvas or overlay code. Every colour
// comes from a theme token (src/components/ui/tokens.ts); the one exception is
// the PDF sheet, which stays white in every theme.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/gi;
const ROOTS = [path.join(__dirname), path.join(__dirname, "..", "workspace")];
const ALLOWED = [/^const SHEET = "#ffffff";$/];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("canvas and overlay colours", () => {
  it("come from theme tokens: no colour literal in the viewer or workspace code except the white sheet", () => {
    const found: string[] = [];
    for (const file of ROOTS.flatMap(sources)) {
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, "").trim();
          if (!COLOR.test(code)) return;
          COLOR.lastIndex = 0;
          if (ALLOWED.some((re) => re.test(code))) return;
          found.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${code}`);
        });
      COLOR.lastIndex = 0;
    }
    expect(found).toEqual([]);
  });
});
