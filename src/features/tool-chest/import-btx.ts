// Story 7.4 (FR42, UX-DR19 F7): Import .btx. The file is read in the .btx
// worker (limits, no external entities, items drawn by pdf.js there, NFR31),
// so a malformed or huge file never blocks the page; the worker is ended
// after each import (or when it takes too long). Then a set named after the
// file's title is created and each item is added to it, one request each: as
// our own markups when it converts (Story 7.5), else as an image at its paper
// size (a count measurement's typed as a device).
//
// Outcomes (F7): all ok → the set, toast "<title> — n tools"; partial → the
// set and a per-item report with reasons; invalid → "Not a Revu tool set
// file", nothing changed.

import { BTX_LIMITS } from "@/core/btx/limits";
import type { BtxErrorCode } from "@/core/btx/errors";
import type { ImportedItem, ImportedToolSet } from "@/core/btx/import";
import { uuidv7 } from "@/core/ids/uuid";
import { DEFAULT_MARKUP_STYLE, type ImageMarkup } from "@/core/schema/markup";
import { MAX_TOOL_IMAGE_BYTES, imageUpload, toolContentOf, type Device, type Tool } from "@/core/tools/tool";
import type { ToolSet } from "@/core/tools/tool-set";
import type { BtxWorkerReply } from "@/workers/btx.worker";

import type { addTool as addToolAction, createToolSet as createToolSetAction } from "./actions";

export const NOT_A_TOOL_SET = "Not a Revu tool set file";
export const NOTHING_IMPORTED = "No tools could be imported";
export const IMPORT_TIMEOUT_MS = 120_000;
export const REASON_NOT_SAVED = "It could not be saved";

/** Why a whole file was refused (the toast's description). */
export function invalidReason(code: BtxErrorCode | undefined): string {
  switch (code) {
    case "file-too-large":
      return `The file is larger than ${BTX_LIMITS.maxFileBytes / 1024 / 1024} MB.`;
    case "too-many-items":
      return `The file has more than ${BTX_LIMITS.maxItems} tools.`;
    case "hex-too-large":
    case "inflate-value-too-large":
    case "inflate-total-too-large":
    case "pdf-too-many-nodes":
    case "too-many-children":
    case "too-many-resources":
      return "The file holds more data than a tool set can.";
    case "xml-forbidden":
      return "The file contains content that is not allowed in a tool set.";
    default:
      return "The file could not be read as a Revu tool set (.btx).";
  }
}

export type ImportReportItem = { name: string; reason: string };

export type ImportOutcome =
  | { kind: "ok"; set: ToolSet; title: string }
  | { kind: "partial"; set: ToolSet; title: string; failed: ImportReportItem[] }
  | { kind: "none"; title: string; failed: ImportReportItem[] }
  | { kind: "invalid"; reason: string; title?: string };

export type ImportDeps = {
  /** Reads and draws the file in the worker. */
  read: (bytes: Uint8Array) => Promise<{ ok: true; set: ImportedToolSet } | { ok: false; code?: BtxErrorCode }>;
  createToolSet: typeof createToolSetAction;
  addTool: typeof addToolAction;
};

/** "Sprinkler Tools — 66 tools" (F7). */
export function importedText(title: string, count: number): string {
  return `${title} — ${count} ${count === 1 ? "tool" : "tools"}`;
}

function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** The set's name: the file's title, else the file name without .btx. */
export function setNameOf(title: string, fileName: string): string {
  const name = title.trim() || fileName.replace(/\.btx$/i, "").trim() || "Imported tools";
  return name.slice(0, 100);
}

/** The image markup of an item `widthPt` × `heightPt` (centred on the origin, upright). */
function itemMarkup(name: string, widthPt: number, heightPt: number, png: Uint8Array): ImageMarkup {
  const w = widthPt / 2;
  const h = heightPt / 2;
  return {
    id: uuidv7(),
    pageId: "import:0",
    createdAt: new Date().toISOString(),
    style: DEFAULT_MARKUP_STYLE,
    type: "image",
    subject: name,
    points: [
      { x: -w, y: h },
      { x: w, y: h },
      { x: w, y: -h },
      { x: -w, y: -h },
    ],
    src: `data:image/png;base64,${base64(png)}`,
  };
}

/**
 * Story 7.5: a count measurement imports as a device of the set (group: the set's name), so placing
 * it counts; its label is its name, numbered when several share one ("Count Measurement 2").
 */
export function deviceLabels(items: readonly ImportedItem[], title: string): Map<number, Device> {
  const out = new Map<number, Device>();
  const seen = new Map<string, number>();
  const group = title.slice(0, 60);
  items.forEach((item, n) => {
    if (!item.ok || item.kind !== "image" || !item.count) return;
    const base = item.name.slice(0, 55);
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    out.set(n, { group, label: k === 1 ? base : `${base} ${k}`, description: "" });
  });
  return out;
}

/** Imports `file` (see the header); never throws. */
export async function importBtx(file: File, deps: ImportDeps): Promise<ImportOutcome> {
  if (file.size > BTX_LIMITS.maxFileBytes) return { kind: "invalid", reason: invalidReason("file-too-large") };
  let read: Awaited<ReturnType<ImportDeps["read"]>>;
  try {
    read = await deps.read(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return { kind: "invalid", reason: invalidReason(undefined) };
  }
  if (!read.ok) return { kind: "invalid", reason: invalidReason(read.code) };
  const title = setNameOf(read.set.title, file.name);
  const failed: ImportReportItem[] = read.set.items.filter((i) => !i.ok).map((i) => ({ name: i.name, reason: i.ok ? "" : i.reason }));
  const drawn = read.set.items.flatMap((i) => (i.ok ? [i] : []));
  if (drawn.length === 0) return { kind: "none", title, failed };

  const created = await deps.createToolSet({ name: title }).catch(() => null);
  if (!created?.ok) return { kind: "invalid", reason: created?.message ?? "The tool set could not be created. Try again." };
  const tools: Tool[] = [];
  const devices = deviceLabels(drawn, title);
  for (const [n, item] of drawn.entries()) {
    const markups = item.kind === "markups" ? item.markups : [itemMarkup(item.name, item.widthPt, item.heightPt, item.png)];
    const made = toolContentOf(markups, { calibration: null, userUnit: 1 });
    const image = made?.image ? imageUpload(made.image) : null;
    if (!made || (made.image !== null && !image)) {
      failed.push({ name: item.name, reason: REASON_NOT_SAVED });
      continue;
    }
    const device = devices.get(n) ?? null;
    const result = await deps.addTool({ set: { id: created.data.id }, name: item.name, content: made.content, device, image }).catch(() => null);
    if (result?.ok) tools.push(result.data.tool);
    else failed.push({ name: item.name, reason: result?.message ?? REASON_NOT_SAVED });
  }
  const set = { ...created.data, tools };
  return failed.length === 0 ? { kind: "ok", set, title } : { kind: "partial", set, title, failed };
}

/** Reads a file in a fresh .btx worker (ended after the reply, or after IMPORT_TIMEOUT_MS). */
export function readInWorker(createWorker: () => Worker = () => new Worker(new URL("../../workers/btx.worker.ts", import.meta.url), { type: "module" })): ImportDeps["read"] {
  return (bytes) =>
    new Promise((resolve) => {
      const worker = createWorker();
      const done = (value: Awaited<ReturnType<ImportDeps["read"]>>) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(value);
      };
      const timer = setTimeout(() => done({ ok: false }), IMPORT_TIMEOUT_MS);
      worker.addEventListener("message", (event: MessageEvent<BtxWorkerReply>) => {
        const reply = event.data;
        if (reply.type === "imported") done({ ok: true, set: reply.set });
        else done({ ok: false, code: reply.type === "error" ? reply.code : undefined });
      });
      worker.addEventListener("error", () => done({ ok: false }));
      const copy = bytes.slice();
      worker.postMessage({ type: "import", reqId: 1, bytes: copy, maxPngBytes: MAX_TOOL_IMAGE_BYTES }, [copy.buffer]);
    });
}
