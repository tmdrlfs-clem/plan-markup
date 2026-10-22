// Copies pdf.js's runtime assets from node_modules/pdfjs-dist into
// public/pdfjs/<version>/ so the render worker loads them same-origin
// (Story 3.1, AR12). Runs on postinstall, predev and prebuild; the output is
// git-ignored. The version in the path makes every file cacheable for good.
//
// Copied: build/pdf.worker.min.mjs (pdf.js's parser, run as a nested worker),
// the wasm image decoders and their JS fallbacks (JBIG2/CCITT, JPX, ICC),
// standard_fonts/, cmaps/, iccs/ and the licences. Not copied: quickjs-eval
// (PDF JavaScript; scripting is disabled) and everything else in the package.
//
// Usage: node scripts/copy-pdfjs-assets.mjs [--check]
//   --check exits 1 when the output is missing or stale (no writes).
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Files and directories (relative to pdfjs-dist) that are served. */
export const PDFJS_ASSETS = Object.freeze([
  "build/pdf.worker.min.mjs",
  "wasm/jbig2.wasm",
  "wasm/jbig2_nowasm_fallback.js",
  "wasm/openjpeg.wasm",
  "wasm/openjpeg_nowasm_fallback.js",
  "wasm/qcms_bg.wasm",
  "wasm/LICENSE_JBIG2",
  "wasm/LICENSE_OPENJPEG",
  "wasm/LICENSE_PDFJS_JBIG2",
  "wasm/LICENSE_PDFJS_OPENJPEG",
  "wasm/LICENSE_PDFJS_QCMS",
  "wasm/LICENSE_QCMS",
  "standard_fonts",
  "cmaps",
  "iccs",
  "LICENSE",
]);

/** The public URL prefix of the copied assets for a pdf.js version (ends in "/"). */
export function pdfjsAssetPrefix(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Unexpected pdfjs-dist version: ${version}`);
  return `/pdfjs/${version}/`;
}

/** Recursive file count of a path (a file counts as 1). */
function countFiles(p) {
  if (!statSync(p).isDirectory()) return 1;
  return readdirSync(p).reduce((n, name) => n + countFiles(path.join(p, name)), 0);
}

/**
 * Copies the assets of `pdfjsDir` into `<publicDir>/pdfjs/<version>/` and removes
 * other versions. Returns what it did. Skips the copy when the target already
 * holds every asset with the same file count (idempotent and fast on reruns).
 */
export function copyPdfjsAssets({ pdfjsDir, publicDir, check = false }) {
  const { version } = JSON.parse(readFileSync(path.join(pdfjsDir, "package.json"), "utf8"));
  const base = path.join(publicDir, "pdfjs");
  const target = path.join(base, version);
  const upToDate = PDFJS_ASSETS.every((rel) => {
    const src = path.join(pdfjsDir, rel);
    const dst = path.join(target, rel);
    return existsSync(dst) && countFiles(dst) === countFiles(src);
  });
  const stale = existsSync(base) ? readdirSync(base).filter((name) => name !== version) : [];
  if (check) return { version, copied: false, upToDate: upToDate && stale.length === 0, removed: [] };
  for (const name of stale) rmSync(path.join(base, name), { recursive: true, force: true });
  if (!upToDate) {
    rmSync(target, { recursive: true, force: true });
    for (const rel of PDFJS_ASSETS) {
      const src = path.join(pdfjsDir, rel);
      if (!existsSync(src)) throw new Error(`pdfjs-dist is missing ${rel}`);
      const dst = path.join(target, rel);
      mkdirSync(path.dirname(dst), { recursive: true });
      cpSync(src, dst, { recursive: true });
    }
  }
  return { version, copied: !upToDate, upToDate: true, removed: stale };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const pdfjsDir = path.join(ROOT, "node_modules", "pdfjs-dist");
  if (!existsSync(pdfjsDir)) {
    // `npm ci --omit=dev` style installs still have pdfjs-dist (a dependency); a
    // missing package means the install itself failed, which npm reports.
    console.error("copy-pdfjs-assets: node_modules/pdfjs-dist not found");
    process.exit(1);
  }
  const result = copyPdfjsAssets({ pdfjsDir, publicDir: path.join(ROOT, "public"), check });
  if (check) {
    if (!result.upToDate) {
      console.error(`public${pdfjsAssetPrefix(result.version)} is missing or stale; run node scripts/copy-pdfjs-assets.mjs`);
      process.exit(1);
    }
  } else if (result.copied || result.removed.length > 0) {
    console.log(`copy-pdfjs-assets: public${pdfjsAssetPrefix(result.version)} ready`);
  }
}
