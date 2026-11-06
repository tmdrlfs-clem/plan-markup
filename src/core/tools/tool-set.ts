// Story 7.1 (FR39): tool set names and the inputs of the tool set actions.

import { z } from "zod";

import { UUID_PATTERN } from "@/core/ids/uuid";

import type { Tool } from "./tool";

export const MAX_TOOL_SET_NAME = 100;
/** At most this many sets per user (the panel lists them all). */
export const MAX_TOOL_SETS = 500;

export const toolSetNameSchema = z.string().trim().min(1, "Enter a name.").max(MAX_TOOL_SET_NAME, `At most ${MAX_TOOL_SET_NAME} characters.`);
const id = z.string().regex(UUID_PATTERN);

export const createToolSetSchema = z.object({ name: toolSetNameSchema });
export const renameToolSetSchema = z.object({ id, name: toolSetNameSchema });
export const moveToolSetSchema = z.object({ id, direction: z.union([z.literal(-1), z.literal(1)]) });
export const deleteToolSetSchema = z.object({ id });

export type ToolSet = { id: string; name: string; position: number; tools: Tool[] };

type Named = { name: string; tools: readonly { name: string }[] };

/** The sets whose name or one of whose tools' names contains every word of `query` (any case); a set matching by name keeps all its tools. */
export function searchToolSets<S extends Named>(sets: readonly S[], query: string): S[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...sets];
  const has = (text: string) => {
    const t = text.toLocaleLowerCase();
    return words.every((w) => t.includes(w));
  };
  const out: S[] = [];
  for (const set of sets) {
    if (has(set.name)) {
      out.push(set);
      continue;
    }
    const tools = set.tools.filter((t) => has(t.name) || has(`${set.name} ${t.name}`));
    if (tools.length > 0) out.push({ ...set, tools });
  }
  return out;
}

/** "Delete “Sprinkler”?" text: how many tools go with it. */
export function deleteSetText(set: Named): string {
  const n = set.tools.length;
  return n === 0 ? `“${set.name}” has no tools.` : `“${set.name}” and its ${n} ${n === 1 ? "tool" : "tools"} will be deleted.`;
}
