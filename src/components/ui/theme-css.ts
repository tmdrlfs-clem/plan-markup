// Test helper: reads globals.css and extracts the per-theme variable blocks.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { THEME_NAMES } from "./token-names";

export const GLOBALS_CSS_PATH = fileURLToPath(
  new URL("../../app/globals.css", import.meta.url),
);

export function readGlobalsCss(): string {
  return readFileSync(GLOBALS_CSS_PATH, "utf8");
}

/** Returns `{ "--name": "value" }` for the `[data-theme="theme"] { ... }` block. */
export function parseThemeBlock(
  css: string,
  theme: (typeof THEME_NAMES)[number],
): Record<string, string> {
  const re = new RegExp(String.raw`\[data-theme="${theme}"\]\s*\{([^}]*)\}`);
  const match = re.exec(css);
  if (!match) {
    throw new Error(`No [data-theme="${theme}"] block in globals.css`);
  }
  const vars: Record<string, string> = {};
  const body = match[1].replace(/\/\*[\s\S]*?\*\//g, "");
  for (const decl of body.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const name = decl.slice(0, idx).trim();
    if (name.startsWith("--")) {
      vars[name] = decl.slice(idx + 1).trim();
    }
  }
  return vars;
}
