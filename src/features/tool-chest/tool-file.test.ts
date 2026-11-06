import { describe, expect, it, vi } from "vitest";

import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";
import { toolContentOf, type Tool } from "@/core/tools/tool";
import { MAX_TOOL_FILE_BYTES, NOT_OUR_TOOL_SET, readToolFile } from "@/core/tools/tool-file";
import type { ToolSet } from "@/core/tools/tool-set";

import type { ImportDeps } from "./import-btx";
import { exportToolSet, exportedText, importToolFile } from "./tool-file";

const line: Markup = {
  id: "00000000-0000-4000-8000-000000000001",
  pageId: "p:0",
  createdAt: "2026-11-07T00:00:00.000Z",
  style: DEFAULT_MARKUP_STYLE,
  type: "line",
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
};
const PNG_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const imageContent = toolContentOf([{ ...line, type: "image", points: [line.points[0], line.points[1], line.points[1], line.points[0]], src: PNG_URL } as Markup], { calibration: null, userUnit: 1 })!.content;
const SET: ToolSet = {
  id: "00000000-0000-4000-8000-0000000000aa",
  name: "Sprinkler Tools",
  position: 1,
  tools: [
    { id: "a", name: "Pipe", content: toolContentOf([line], { calibration: null, userUnit: 1 })!.content, device: null, imageUrl: null },
    { id: "b", name: "Head", content: imageContent, device: { group: "Heads", label: "Upright", description: "" }, imageUrl: "https://storage/head.png?token=1" },
  ],
};

async function exported(): Promise<{ text: string; name: string }> {
  let saved: { name: string; blob: Blob } | null = null;
  await exportToolSet(SET, { image: async () => PNG_URL, save: (name, blob) => (saved = { name, blob }) });
  return { name: saved!.name, text: await saved!.blob.text() };
}

function deps(fail: string[] = []): Pick<ImportDeps, "createToolSet" | "addTool"> & { added: { name: string; image: unknown; device: unknown }[] } {
  const added: { name: string; image: unknown; device: unknown }[] = [];
  return {
    added,
    createToolSet: vi.fn(async ({ name }: { name: string }) => ({ ok: true as const, data: { ...SET, id: "00000000-0000-4000-8000-0000000000bb", name, tools: [] } })) as unknown as ImportDeps["createToolSet"],
    addTool: vi.fn(async (input: { name: string; image: unknown; device: unknown }) => {
      added.push(input);
      if (fail.includes(input.name)) return { ok: false as const, code: "INTERNAL" as const, message: "Something went wrong." };
      return { ok: true as const, data: { set: null, setId: "s", tool: { id: input.name, name: input.name } as Tool } };
    }) as unknown as ImportDeps["addTool"],
  };
}

describe("export and import a tool set file (Story 7.6, FR43)", () => {
  it("export: the set's file with each tool's image embedded, named after the set", async () => {
    const { name, text } = await exported();
    expect(name).toBe("Sprinkler Tools.tools.json");
    const read = readToolFile(text);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.file.set.tools.map((t) => [t.name, t.image?.type ?? null])).toEqual([
      ["Pipe", null],
      ["Head", "image/png"],
    ]);
    expect(exportedText("One", 1)).toBe("Exported “One” — 1 tool");
  });

  it("export: a tool whose image cannot be fetched is left out and named", async () => {
    let saved: Blob | null = null;
    const out = await exportToolSet(SET, { image: async () => null, save: (_n, blob) => (saved = blob) });
    expect(out).toMatchObject({ count: 1, skipped: ["Head"] });
    expect(saved).not.toBeNull();
  });

  it("import: a new set with every tool, its device and image", async () => {
    const { text, name } = await exported();
    const d = deps();
    const out = await importToolFile(new File([text], name), d);
    expect(out).toMatchObject({ kind: "ok", title: "Sprinkler Tools", set: { name: "Sprinkler Tools" } });
    expect(d.added.map((t) => t.name)).toEqual(["Pipe", "Head"]);
    expect(d.added[1]).toMatchObject({ device: { group: "Heads", label: "Upright" }, image: { type: "image/png" } });
  });

  it("import: an invalid file changes nothing; a tool that cannot be saved is reported", async () => {
    const d = deps();
    const bad = await importToolFile(new File(["{\"format\":\"x\"}"], "a.json"), d);
    expect(bad).toEqual({ kind: "invalid", title: NOT_OUR_TOOL_SET, reason: "The file is not a tool set exported from Plan Markup." });
    const big = { size: MAX_TOOL_FILE_BYTES + 1, name: "big.json", text: () => Promise.reject(new Error("must not read")) } as unknown as File;
    expect(await importToolFile(big, d)).toMatchObject({ kind: "invalid", reason: "The file is larger than 64 MB." });
    expect(d.createToolSet).not.toHaveBeenCalled();

    const { text } = await exported();
    const partly = deps(["Head"]);
    const out = await importToolFile(new File([text], "s.json"), partly);
    expect(out).toMatchObject({ kind: "partial", failed: [{ name: "Head", reason: "Something went wrong." }] });
  });
});
