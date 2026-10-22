import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PDFJS_ASSETS, copyPdfjsAssets, pdfjsAssetPrefix } from "./copy-pdfjs-assets.mjs";

let tmp;
let pdfjsDir;
let publicDir;

function fakePdfjs(version) {
  writeFileSync(path.join(pdfjsDir, "package.json"), JSON.stringify({ version }));
  for (const rel of PDFJS_ASSETS) {
    const isDir = !rel.includes(".") && !rel.startsWith("wasm/") && rel !== "LICENSE";
    const p = path.join(pdfjsDir, rel);
    if (isDir) {
      mkdirSync(p, { recursive: true });
      writeFileSync(path.join(p, "a.bin"), "a");
      writeFileSync(path.join(p, "b.bin"), "b");
    } else {
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, rel);
    }
  }
  mkdirSync(path.join(pdfjsDir, "wasm"), { recursive: true });
  writeFileSync(path.join(pdfjsDir, "wasm", "quickjs-eval.wasm"), "not served");
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "pdfjs-assets-"));
  pdfjsDir = path.join(tmp, "pdfjs-dist");
  publicDir = path.join(tmp, "public");
  mkdirSync(pdfjsDir, { recursive: true });
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("copyPdfjsAssets", () => {
  it("copies the listed assets into a versioned folder and nothing else", () => {
    fakePdfjs("6.4.299");
    const result = copyPdfjsAssets({ pdfjsDir, publicDir });
    expect(result).toEqual({ version: "6.4.299", copied: true, upToDate: true, removed: [] });
    const target = path.join(publicDir, "pdfjs", "6.4.299");
    expect(existsSync(path.join(target, "build", "pdf.worker.min.mjs"))).toBe(true);
    expect(readdirSync(path.join(target, "cmaps")).sort()).toEqual(["a.bin", "b.bin"]);
    expect(existsSync(path.join(target, "wasm", "quickjs-eval.wasm"))).toBe(false);
  });

  it("is idempotent and reports a fresh copy as up to date", () => {
    fakePdfjs("6.4.299");
    copyPdfjsAssets({ pdfjsDir, publicDir });
    expect(copyPdfjsAssets({ pdfjsDir, publicDir }).copied).toBe(false);
    expect(copyPdfjsAssets({ pdfjsDir, publicDir, check: true }).upToDate).toBe(true);
  });

  it("removes other versions and --check flags stale output without writing", () => {
    fakePdfjs("6.4.299");
    copyPdfjsAssets({ pdfjsDir, publicDir });
    fakePdfjs("6.5.0");
    expect(copyPdfjsAssets({ pdfjsDir, publicDir, check: true }).upToDate).toBe(false);
    expect(existsSync(path.join(publicDir, "pdfjs", "6.5.0"))).toBe(false);
    const result = copyPdfjsAssets({ pdfjsDir, publicDir });
    expect(result.removed).toEqual(["6.4.299"]);
    expect(readdirSync(path.join(publicDir, "pdfjs"))).toEqual(["6.5.0"]);
  });

  it("fails when pdfjs-dist lacks an asset", () => {
    fakePdfjs("6.4.299");
    rmSync(path.join(pdfjsDir, "wasm", "openjpeg.wasm"));
    expect(() => copyPdfjsAssets({ pdfjsDir, publicDir })).toThrow(/missing wasm\/openjpeg.wasm/);
  });
});

describe("pdfjsAssetPrefix", () => {
  it("builds the versioned prefix and rejects odd versions", () => {
    expect(pdfjsAssetPrefix("6.4.299")).toBe("/pdfjs/6.4.299/");
    expect(() => pdfjsAssetPrefix("../x")).toThrow();
  });
});
