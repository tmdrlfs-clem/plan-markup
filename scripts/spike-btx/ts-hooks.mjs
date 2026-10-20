// Lets the spike harness import src/core TypeScript directly with Node's
// built-in type stripping (Node >= 22.18 / 23.6): resolves the "@/…" alias and
// extensionless relative imports to ".ts" files. No build step, no dependency.
// Usage: node --import ./scripts/spike-btx/ts-hooks.mjs scripts/spike-btx/run.mjs
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");

function tryTs(file) {
  for (const candidate of [file, `${file}.ts`, path.join(file, "index.ts")]) {
    if (/\.[cm]?[jt]s$/.test(candidate) && existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const url = tryTs(path.join(SRC, specifier.slice(2)));
      if (url) return { url, format: url.endsWith(".ts") ? "module-typescript" : undefined, shortCircuit: true };
    } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.endsWith(".ts")) {
      const url = tryTs(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
      if (url) return { url, format: url.endsWith(".ts") ? "module-typescript" : undefined, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
