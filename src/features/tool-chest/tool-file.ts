// Story 7.6 (FR43): export a tool set to our own file, and import one as a new
// set. Export embeds each tool's image (fetched by its signed URL) and saves
// the file locally; import checks the file's size before reading it, then
// validates all of it (core/tools/tool-file) before anything is created, so an
// invalid file changes nothing. Saving the tools is one request each; one that
// fails is reported like a .btx import's (Story 7.4's report).

import { imageUpload } from "@/core/tools/tool";
import { MAX_TOOL_FILE_BYTES, NOT_OUR_TOOL_SET, readToolFile, toolFileName, toolFileOf } from "@/core/tools/tool-file";
import type { Tool } from "@/core/tools/tool";
import type { ToolSet } from "@/core/tools/tool-set";

import type { ImportDeps, ImportOutcome, ImportReportItem } from "./import-btx";
import { REASON_NOT_SAVED } from "./import-btx";

export type ExportDeps = {
  /** A tool image's data URL by its signed URL (null when it cannot be read). */
  image: (url: string) => Promise<string | null>;
  /** Saves `blob` as `name` on the user's machine. */
  save: (name: string, blob: Blob) => void;
  now?: () => Date;
};

export type ExportResult = { fileName: string; count: number; skipped: string[] };

/** Saves `set` as a file; tools that cannot be read (or whose image cannot be fetched) are left out and named. */
export async function exportToolSet(set: ToolSet, deps: ExportDeps): Promise<ExportResult> {
  const images = await Promise.all(
    set.tools.map(async (t) => {
      if (!t.imageUrl) return null;
      const data = await deps.image(t.imageUrl).catch(() => null);
      return data ? imageUpload(data) : null;
    }),
  );
  const { file, skipped } = toolFileOf(set, images, (deps.now?.() ?? new Date()).toISOString());
  const fileName = toolFileName(set.name);
  deps.save(fileName, new Blob([JSON.stringify(file)], { type: "application/json" }));
  return { fileName, count: file.set.tools.length, skipped };
}

/** "Exported “Sprinkler Tools” — 66 tools". */
export function exportedText(name: string, count: number): string {
  return `Exported “${name}” — ${count} ${count === 1 ? "tool" : "tools"}`;
}

/** Saves a blob through a temporary link (the browser's download). */
export function saveBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Imports one of our tool set files as a new set (see the header); never throws. */
export async function importToolFile(file: File, deps: Pick<ImportDeps, "createToolSet" | "addTool">): Promise<ImportOutcome> {
  const invalid = (reason: string): ImportOutcome => ({ kind: "invalid", reason, title: NOT_OUR_TOOL_SET });
  if (file.size > MAX_TOOL_FILE_BYTES) return invalid(`The file is larger than ${MAX_TOOL_FILE_BYTES / 1024 / 1024} MB.`);
  let text: string;
  try {
    text = await file.text();
  } catch {
    return invalid("The file could not be read.");
  }
  const read = readToolFile(text);
  if (!read.ok) return invalid(read.reason);
  const { name, tools: entries } = read.file.set;
  const failed: ImportReportItem[] = [];
  if (entries.length === 0) return { kind: "none", title: name, failed };
  const created = await deps.createToolSet({ name }).catch(() => null);
  if (!created?.ok) return { kind: "invalid", reason: created?.message ?? "The tool set could not be created. Try again." };
  const tools: Tool[] = [];
  for (const t of entries) {
    const result = await deps.addTool({ set: { id: created.data.id }, name: t.name, content: t.content, device: t.device, image: t.image }).catch(() => null);
    if (result?.ok) tools.push(result.data.tool);
    else failed.push({ name: t.name, reason: result?.message ?? REASON_NOT_SAVED });
  }
  const set = { ...created.data, tools };
  if (tools.length === 0) return { kind: "partial", set, title: name, failed };
  return failed.length === 0 ? { kind: "ok", set, title: name } : { kind: "partial", set, title: name, failed };
}
