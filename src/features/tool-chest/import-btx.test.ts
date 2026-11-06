import { describe, expect, it, vi } from "vitest";

import type { ImportedToolSet } from "@/core/btx/import";
import type { ToolSet } from "@/core/tools/tool-set";

import { NOTHING_IMPORTED, REASON_NOT_SAVED, deviceLabels, importBtx, importedText, invalidReason, readInWorker, setNameOf, type ImportDeps } from "./import-btx";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const SET: ToolSet = { id: "00000000-0000-4000-8000-000000000001", name: "Sprinkler Tools", position: 1, tools: [] };

function file(name = "sprinkler.btx", size = 10): File {
  return new File([new Uint8Array(size)], name);
}

function deps(set: ImportedToolSet | { code?: "structure-invalid" | "file-too-large" }, addFails: string[] = []): ImportDeps & { added: unknown[] } {
  const added: unknown[] = [];
  return {
    added,
    read: async () => ("items" in set ? { ok: true, set } : { ok: false, code: set.code }),
    createToolSet: vi.fn(async ({ name }: { name: string }) => ({ ok: true as const, data: { ...SET, name } })) as unknown as ImportDeps["createToolSet"],
    addTool: vi.fn(async (input: { name: string }) => {
      added.push(input);
      if (addFails.includes(input.name)) return { ok: false as const, code: "INTERNAL" as const, message: "Something went wrong." };
      return { ok: true as const, data: { set: null, setId: SET.id, tool: { id: input.name, name: input.name, content: null, device: null, imageUrl: null } } };
    }) as unknown as ImportDeps["addTool"],
  };
}

const ok = (name: string) => ({ name, ok: true as const, kind: "image" as const, widthPt: 20, heightPt: 10, png: PNG, warnings: [], count: false });

describe("Import .btx (Story 7.4, F7)", () => {
  it("all ok: a set named after the title with every item as an image tool at its paper size", async () => {
    const d = deps({ title: "Sprinkler Tools", items: [ok("Head"), ok("Valve")], warnings: [] });
    const out = await importBtx(file(), d);
    expect(out).toMatchObject({ kind: "ok", title: "Sprinkler Tools", set: { name: "Sprinkler Tools" } });
    if (out.kind !== "ok") return;
    expect(out.set.tools.map((t) => t.name)).toEqual(["Head", "Valve"]);
    expect(importedText(out.title, out.set.tools.length)).toBe("Sprinkler Tools — 2 tools");
    const first = d.added[0] as { set: { id: string }; content: { markups: { type: string; points: { x: number; y: number }[]; subject: string }[]; calibration: null }; image: { type: string } };
    expect(first.set).toEqual({ id: SET.id });
    expect(first.image.type).toBe("image/png");
    expect(first.content.calibration).toBeNull();
    expect(first.content.markups[0]).toMatchObject({ type: "image", subject: "Head" });
    expect(first.content.markups[0]!.points[1]).toEqual({ x: 10, y: 5 });
  });

  it("partial: the set with what was drawn and saved, and a report of the rest with reasons", async () => {
    const d = deps({ title: "", items: [ok("Head"), { name: "Snapshot", ok: false, reason: "It draws nothing" }, ok("Valve")], warnings: [] }, ["Valve"]);
    const out = await importBtx(file("My Tools.BTX"), d);
    expect(out.kind).toBe("partial");
    if (out.kind !== "partial") return;
    expect(out.title).toBe("My Tools");
    expect(out.set.tools.map((t) => t.name)).toEqual(["Head"]);
    expect(out.failed).toEqual([
      { name: "Snapshot", reason: "It draws nothing" },
      { name: "Valve", reason: "Something went wrong." },
    ]);
  });

  it("invalid: nothing changes, with the reason; none drawn: nothing is created", async () => {
    for (const code of ["structure-invalid", "file-too-large"] as const) {
      const d = deps({ code });
      expect(await importBtx(file(), d)).toEqual({ kind: "invalid", reason: invalidReason(code) });
      expect(d.createToolSet).not.toHaveBeenCalled();
    }
    const tooBig = deps({ title: "x", items: [], warnings: [] });
    expect(await importBtx(file("big.btx", 33 * 1024 * 1024), tooBig)).toEqual({ kind: "invalid", reason: "The file is larger than 32 MB." });
    const none = deps({ title: "Empty", items: [{ name: "Snapshot", ok: false, reason: "It draws nothing" }], warnings: [] });
    expect(await importBtx(file(), none)).toEqual({ kind: "none", title: "Empty", failed: [{ name: "Snapshot", reason: "It draws nothing" }] });
    expect(none.createToolSet).not.toHaveBeenCalled();
    const thrown: ImportDeps = { ...deps({ code: "structure-invalid" }), read: async () => Promise.reject(new Error("worker died")) };
    expect((await importBtx(file(), thrown)).kind).toBe("invalid");
    expect(NOTHING_IMPORTED).toBe("No tools could be imported");
    expect(REASON_NOT_SAVED).toBe("It could not be saved");
  });

  it("Story 7.5: a converted item is a tool of its markups (no image); a count is a device of the set", async () => {
    const pen = {
      id: "00000000-0000-4000-8000-0000000000aa",
      pageId: "import:0",
      createdAt: "2026-11-07T00:00:00.000Z",
      type: "pen" as const,
      subject: "Pen",
      style: { color: "#000000", width: 2, fontSize: 10 },
      points: [{ x: 0, y: 0 }, { x: 10, y: 4 }],
    };
    const count = { ...ok("Count Measurement"), count: true };
    const d = deps({ title: "Sprinkler Tools", items: [{ name: "Pen", ok: true, kind: "markups", markups: [pen] }, count, { ...count }], warnings: [] });
    const out = await importBtx(file(), d);
    expect(out.kind).toBe("ok");
    const [first, second, third] = d.added as { image: unknown; device: unknown; content: { markups: { type: string; points: unknown[] }[] } }[];
    expect(first!.image).toBeNull();
    expect(first!.device).toBeNull();
    // Centred on the origin like any tool.
    expect(first!.content.markups[0]).toMatchObject({ type: "pen", points: [{ x: -5, y: -2 }, { x: 5, y: 2 }] });
    expect(second!.device).toEqual({ group: "Sprinkler Tools", label: "Count Measurement", description: "" });
    expect(third!.device).toEqual({ group: "Sprinkler Tools", label: "Count Measurement 2", description: "" });
    expect(deviceLabels([ok("Head")], "x").size).toBe(0);
  });

  it("names: the title, else the file name; at most 100 characters", () => {
    expect(setNameOf(" Fire Alarm ", "x.btx")).toBe("Fire Alarm");
    expect(setNameOf("", "sprinkler-tools.btx")).toBe("sprinkler-tools");
    expect(setNameOf("", ".btx")).toBe("Imported tools");
    expect(setNameOf("a".repeat(150), "x.btx")).toHaveLength(100);
    expect(importedText("One", 1)).toBe("One — 1 tool");
  });

  it("reads in a worker that is ended after the reply, or after an error", async () => {
    const workers: { terminate: ReturnType<typeof vi.fn>; listeners: Record<string, (e: unknown) => void>; posted: unknown[] }[] = [];
    const create = () => {
      const w = { terminate: vi.fn(), listeners: {} as Record<string, (e: unknown) => void>, posted: [] as unknown[] };
      workers.push(w);
      return {
        terminate: w.terminate,
        addEventListener: (type: string, fn: (e: unknown) => void) => (w.listeners[type] = fn),
        postMessage: (m: unknown) => w.posted.push(m),
      } as unknown as Worker;
    };
    const read = readInWorker(create);
    const set: ImportedToolSet = { title: "T", items: [], warnings: [] };
    const first = read(new Uint8Array([1, 2]));
    expect(workers[0]!.posted[0]).toMatchObject({ type: "import", reqId: 1 });
    workers[0]!.listeners.message!({ data: { type: "imported", reqId: 1, set } });
    expect(await first).toEqual({ ok: true, set });
    expect(workers[0]!.terminate).toHaveBeenCalled();
    const second = read(new Uint8Array([1]));
    workers[1]!.listeners.message!({ data: { type: "error", reqId: 1, error: { name: "BtxError", message: "x" }, code: "xml-forbidden" } });
    expect(await second).toEqual({ ok: false, code: "xml-forbidden" });
    const third = read(new Uint8Array([1]));
    workers[2]!.listeners.error!({});
    expect(await third).toEqual({ ok: false });
    expect(invalidReason("xml-forbidden")).toBe("The file contains content that is not allowed in a tool set.");
  });
});
