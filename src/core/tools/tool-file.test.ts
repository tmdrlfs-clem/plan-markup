import { describe, expect, it } from "vitest";

import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";

import { toolContentOf } from "./tool";
import { MAX_TOOL_FILE_TOOLS, TOOL_FILE_FORMAT, TOOL_FILE_VERSION, imageMatches, readToolFile, toolFileName, toolFileOf } from "./tool-file";

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
const image: Markup = {
  ...line,
  id: "00000000-0000-4000-8000-000000000002",
  type: "image",
  points: [
    { x: 0, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
    { x: 0, y: 0 },
  ],
  src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
};
const lineContent = toolContentOf([line], { calibration: null, userUnit: 1 })!.content;
const imageContent = toolContentOf([image], { calibration: null, userUnit: 1 })!.content;
const PNG = { type: "image/png" as const, base64: "iVBORw0KGgoAAAANSUhEUg==" };
const DEVICE = { group: "Heads", label: "Upright", description: "" };

const set = {
  name: "Sprinkler / Tools",
  tools: [
    { name: "Pipe", content: lineContent, device: null },
    { name: "Head", content: imageContent, device: DEVICE },
    { name: "Broken", content: null, device: null },
    { name: "No image", content: imageContent, device: null },
  ],
};

describe("tool set files (Story 7.6, FR43)", () => {
  it("export: versioned, every readable tool with its device and embedded image; the rest named", () => {
    const { file, skipped } = toolFileOf(set, [null, PNG, null, null], "2026-11-07T00:00:00.000Z");
    expect(file).toMatchObject({ format: TOOL_FILE_FORMAT, version: TOOL_FILE_VERSION, set: { name: "Sprinkler / Tools" } });
    expect(file.set.tools.map((t) => t.name)).toEqual(["Pipe", "Head"]);
    expect(file.set.tools[1]).toMatchObject({ device: DEVICE, image: PNG });
    expect(skipped).toEqual(["Broken", "No image"]);
    expect(toolFileName(set.name)).toBe("Sprinkler Tools.tools.json");
    expect(toolFileName(" :: ")).toBe("Tool set.tools.json");
  });

  it("import: an exported file reads back as it was", () => {
    const { file } = toolFileOf(set, [null, PNG, null, null], "2026-11-07T00:00:00.000Z");
    const read = readToolFile(JSON.stringify(file));
    expect(read).toEqual({ ok: true, file });
  });

  it("refuses what is not ours, another version, or any invalid tool, with the reason", () => {
    const { file } = toolFileOf(set, [null, PNG, null, null], "x");
    expect(readToolFile("{")).toEqual({ ok: false, reason: "The file is not JSON." });
    expect(readToolFile(JSON.stringify({ hello: 1 }))).toEqual({ ok: false, reason: "The file is not a tool set exported from Plan Markup." });
    expect(readToolFile(JSON.stringify({ ...file, version: 2 }))).toEqual({ ok: false, reason: "The file is version 2; this app reads version 1." });
    const noImage = { ...file, set: { ...file.set, tools: [file.set.tools[0], { ...file.set.tools[1], image: null }] } };
    expect(readToolFile(JSON.stringify(noImage))).toEqual({ ok: false, reason: "Tool 2: A tool's image is missing." });
    const fake = { ...file, set: { ...file.set, tools: [{ ...file.set.tools[1], image: { type: "image/png", base64: "PHN2ZyB4bWxucz0=" } }] } };
    expect(readToolFile(JSON.stringify(fake))).toEqual({ ok: false, reason: "Tool 1: A tool's image is not a PNG or JPEG." });
    const script = { ...file, set: { ...file.set, tools: [{ ...file.set.tools[0], content: { ...lineContent, markups: [{ ...lineContent.markups[0], type: "script" }] } }] } };
    expect(readToolFile(JSON.stringify(script)).ok).toBe(false);
    const many = { ...file, set: { ...file.set, tools: Array.from({ length: MAX_TOOL_FILE_TOOLS + 1 }, () => file.set.tools[0]) } };
    expect(readToolFile(JSON.stringify(many)).ok).toBe(false);
    expect(readToolFile(JSON.stringify({ ...file, set: { ...file.set, name: "" } })).ok).toBe(false);
  });

  it("an image's bytes must be its type's", () => {
    expect(imageMatches(PNG)).toBe(true);
    expect(imageMatches({ type: "image/jpeg", base64: "/9j/4AAQSkZJRg==" })).toBe(true);
    expect(imageMatches({ type: "image/jpeg", base64: PNG.base64 })).toBe(false);
  });
});
