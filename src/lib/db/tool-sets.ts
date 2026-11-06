import type { SupabaseClient } from "@supabase/supabase-js";

import { MAX_TOOL_SETS, type ToolSet } from "@/core/tools/tool-set";

import type { Database } from "./types.gen";

// Story 7.1 (FR39): the caller's tool sets through RLS (owner only, active
// users only). Errors carry the SQLSTATE only.

type Client = SupabaseClient<Database>;

function failed(what: string, error: { code?: string } | null): Error {
  return new Error(`${what} failed: ${error?.code ?? "unknown"}`);
}

/** The caller's sets in their order, each with its tools' ids and names in order. */
export async function listToolSets(client: Client): Promise<ToolSet[]> {
  const { data, error } = await client
    .from("tool_sets")
    .select("id, name, position, tools(id, name, position)")
    .order("position")
    .order("created_at")
    .limit(MAX_TOOL_SETS);
  if (error) throw failed("tool_sets select", error);
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    tools: [...(s.tools ?? [])].sort((a, b) => a.position - b.position).map((t) => ({ id: t.id, name: t.name })),
  }));
}

/** A new set after the caller's last one; null when they have MAX_TOOL_SETS already. */
export async function createToolSet(client: Client, name: string): Promise<ToolSet | null> {
  const { data: last, error: readError, count } = await client
    .from("tool_sets")
    .select("position", { count: "exact" })
    .order("position", { ascending: false })
    .limit(1);
  if (readError) throw failed("tool_sets select", readError);
  if ((count ?? 0) >= MAX_TOOL_SETS) return null;
  const position = (last?.[0]?.position ?? 0) + 1;
  const { data, error } = await client.from("tool_sets").insert({ name, position }).select("id, name, position").single();
  if (error) throw failed("tool_sets insert", error);
  return { ...data, tools: [] };
}

/** Renames set `id`; false when the caller has no such set. */
export async function renameToolSet(client: Client, id: string, name: string): Promise<boolean> {
  const { data, error } = await client.from("tool_sets").update({ name, updated_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error) throw failed("tool_sets update", error);
  return (data ?? []).length > 0;
}

/** Swaps set `id` with its neighbour before (-1) or after (1); false when there is none. */
export async function moveToolSet(client: Client, id: string, direction: -1 | 1): Promise<boolean> {
  const sets = await listToolSets(client);
  const at = sets.findIndex((s) => s.id === id);
  const other = sets[at + direction];
  if (at < 0 || !other) return false;
  const here = sets[at];
  // Equal positions (never normally) still swap: renumber the two around each other.
  const [a, b] = here.position === other.position ? [other.position + direction, other.position] : [other.position, here.position];
  const now = new Date().toISOString();
  const first = await client.from("tool_sets").update({ position: a, updated_at: now }).eq("id", here.id);
  if (first.error) throw failed("tool_sets update", first.error);
  const second = await client.from("tool_sets").update({ position: b, updated_at: now }).eq("id", other.id);
  if (second.error) throw failed("tool_sets update", second.error);
  return true;
}

/** Deletes set `id` and its tools; false when the caller has no such set. */
export async function deleteToolSet(client: Client, id: string): Promise<boolean> {
  const { data, error } = await client.from("tool_sets").delete().eq("id", id).select("id");
  if (error) throw failed("tool_sets delete", error);
  return (data ?? []).length > 0;
}
