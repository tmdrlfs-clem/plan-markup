// Server-only file lookups for the dev-only spike routes (Story 2.3). Pure
// whitelists: request input never becomes a path without matching one.
import "server-only";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/** Private fixtures the spike may stream (git-ignored, local machine only). */
export const SPIKE_FIXTURES: Readonly<Record<string, string>> = Object.freeze({
  l17: "A1721-LEVEL-17-REFLECTED-CEILING-PLAN-Rev.2.pdf",
  l21: "A2121-LEVEL-21-REFLECTED-CEILING-PLAN-Rev.2.pdf",
  a0: "synthetic-a0-50mb.pdf",
});

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PDFJS_DIRS: ReadonlySet<string> = new Set(["wasm", "standard_fonts", "cmaps", "iccs"]);
const PDFJS_FILES: ReadonlySet<string> = new Set(["build/pdf.worker.min.mjs", "build/pdf.worker.mjs"]);

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".wasm": "application/wasm",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

/** Relative pdfjs-dist path for a route's [...path] segments, or null when not whitelisted. */
export function pdfjsAssetPath(segments: readonly string[]): string | null {
  if (segments.length === 2 && PDFJS_FILES.has(segments.join("/"))) return segments.join("/");
  if (segments.length !== 2) return null;
  const [dir, file] = segments;
  return PDFJS_DIRS.has(dir) && SAFE_NAME.test(file) && !file.includes("..") ? `${dir}/${file}` : null;
}

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream";
}

/** Streams a file as a Response, or null when it does not exist. */
export async function fileResponse(absolute: string, contentType: string): Promise<Response | null> {
  try {
    const info = await stat(absolute);
    if (!info.isFile()) return null;
    const body = Readable.toWeb(createReadStream(absolute)) as ReadableStream<Uint8Array>;
    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(info.size),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return null;
  }
}

// Resolved from process.cwd() at request time. The file tracer still sees
// these joins, so next.config.ts excludes fixtures/private (every route) and
// pdfjs-dist (spike routes) from the server traces.
export const fixturePath = (file: string): string => path.join(process.cwd(), "fixtures", "private", "pdf", file);
export const pdfjsPath = (rel: string): string => path.join(process.cwd(), "node_modules", "pdfjs-dist", ...rel.split("/"));
