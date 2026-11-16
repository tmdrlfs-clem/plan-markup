import { describe, expect, it } from "vitest";

import type { Tool } from "./tool";
import {
  createToolSetSchema,
  deleteSetText,
  moveToolSetSchema,
  ownToolSets,
  publishToolSetSchema,
  renameToolSetSchema,
  searchToolSets,
  type ToolSet,
} from "./tool-set";

const ID = "00000000-0000-4000-8000-000000000001";
const tool = (id: string, name: string): Tool => ({ id, name, content: null, device: null, imageUrl: null });
const sets: ToolSet[] = [
  { id: "a", name: "Sprinkler heads", position: 1, tools: [tool("1", "Pendant"), tool("2", "Upright")] },
  { id: "b", name: "Fire alarm", position: 2, tools: [tool("3", "Smoke detector"), tool("4", "Pendant sounder")] },
  { id: "c", name: "Empty", position: 3, tools: [] },
];

describe("tool sets (Story 7.1)", () => {
  it("search keeps sets matching by name with all their tools, else only their matching tools", () => {
    expect(searchToolSets(sets, "")).toHaveLength(3);
    expect(searchToolSets(sets, "SPRINKLER").map((s) => [s.name, s.tools.length])).toEqual([["Sprinkler heads", 2]]);
    expect(searchToolSets(sets, "pendant").map((s) => [s.name, s.tools.map((t) => t.name)])).toEqual([
      ["Sprinkler heads", ["Pendant"]],
      ["Fire alarm", ["Pendant sounder"]],
    ]);
    // Words across the set and tool names.
    expect(searchToolSets(sets, "alarm smoke").map((s) => s.tools.map((t) => t.name))).toEqual([["Smoke detector"]]);
    expect(searchToolSets(sets, "nothing")).toEqual([]);
  });

  it("the delete confirmation names the tool count", () => {
    expect(deleteSetText(sets[0])).toBe("“Sprinkler heads” and its 2 tools will be deleted.");
    expect(deleteSetText({ name: "One", tools: [{ name: "x" }] })).toBe("“One” and its 1 tool will be deleted.");
    expect(deleteSetText(sets[2])).toBe("“Empty” has no tools.");
  });

  it("validates names (trimmed, 1–100) and moves (±1)", () => {
    expect(createToolSetSchema.parse({ name: "  Heads  " })).toEqual({ name: "Heads" });
    expect(createToolSetSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createToolSetSchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
    expect(renameToolSetSchema.safeParse({ id: "nope", name: "A" }).success).toBe(false);
    expect(moveToolSetSchema.safeParse({ id: ID, direction: 2 }).success).toBe(false);
    expect(moveToolSetSchema.safeParse({ id: ID, direction: -1 }).success).toBe(true);
  });
});

describe("company tool sets (Story 10.11)", () => {
  const shared: ToolSet = { id: "s", name: "Company symbols", position: 1, tools: [tool("9", "Valve")], company: "shared" };
  const published: ToolSet = { ...sets[0], company: "published" };

  it("the user's own sets are the ones they can change", () => {
    expect(ownToolSets([shared, published, sets[1]]).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("search keeps the company mark", () => {
    expect(searchToolSets([shared, published], "valve").map((s) => s.company)).toEqual(["shared"]);
  });

  it("deleting a published set says the company loses it", () => {
    expect(deleteSetText(published)).toBe("“Sprinkler heads” and its 2 tools will be deleted. Your company will no longer have it.");
  });

  it("publishing takes a set id and a boolean", () => {
    expect(publishToolSetSchema.safeParse({ id: ID, published: true }).success).toBe(true);
    expect(publishToolSetSchema.safeParse({ id: ID }).success).toBe(false);
    expect(publishToolSetSchema.safeParse({ id: "x", published: false }).success).toBe(false);
  });
});
