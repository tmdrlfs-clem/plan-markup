import type { SupabaseClient } from "@supabase/supabase-js";

import { deviceSchema, toolContentSchema, type AddToolInput, type Tool } from "@/core/tools/tool";
import { MAX_TOOL_SETS, type ToolSet } from "@/core/tools/tool-set";

import type { Database, Json } from "./types.gen";

// Stories 7.1 / 7.2 (FR39, FR40, AR19): the caller's tool sets and tools
// through RLS (owner only, active users only); a tool's image in the private
// `tool-assets` bucket at `<owner_id>/<tool_set_id>/<tool_id>.<ext>`, served by
// signed URLs of 10 minutes. Errors carry the SQLSTATE only.
// Story 10.11 (FR44): RLS also shows the sets published to the caller's
// company, read-only; every write here names the caller's own sets.

type Client = SupabaseClient<Database>;

export const TOOL_ASSETS = "tool-assets";
export const SIGNED_URL_SECONDS = 600;
/** At most this many tools in a set. */
export const MAX_TOOLS_PER_SET = 1000;

function failed(what: string, error: { code?: string } | null): Error {
  return new Error(`${what} failed: ${error?.code ?? "unknown"}`);
}

type ToolRow = { id: string; name: string; position: number; markup: Json; device: Json | null; asset_path: string | null };

function toolOf(t: ToolRow, urls: ReadonlyMap<string, string>): Tool {
  const content = toolContentSchema.safeParse(t.markup);
  const device = t.device === null ? null : deviceSchema.safeParse(t.device);
  return {
    id: t.id,
    name: t.name,
    content: content.success ? content.data : null,
    device: device?.success ? device.data : null,
    imageUrl: t.asset_path ? (urls.get(t.asset_path) ?? null) : null,
  };
}

/** At most this many sets published to one company (the database refuses more). */
export const MAX_COMPANY_TOOL_SETS = 100;

/**
 * The sets of the caller's company that others published (by name), then the
 * caller's own in their order; each with its tools in order (images by signed URL).
 */
export async function listToolSets(client: Client, userId: string): Promise<ToolSet[]> {
  const { data, error } = await client
    .from("tool_sets")
    .select("id, name, position, owner_id, company_id, tools(id, name, position, markup, device, asset_path)")
    .order("position")
    .order("created_at")
    .limit(MAX_TOOL_SETS + MAX_COMPANY_TOOL_SETS);
  if (error) throw failed("tool_sets select", error);
  const rows = data ?? [];
  const paths: string[] = [];
  for (const s of rows) for (const t of s.tools ?? []) if (t.asset_path) paths.push(t.asset_path);
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed, error: signError } = await client.storage.from(TOOL_ASSETS).createSignedUrls(paths, SIGNED_URL_SECONDS);
    if (signError) throw failed("tool-assets sign", null);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  const own: ToolSet[] = [];
  const shared: ToolSet[] = [];
  for (const s of rows) {
    const set: ToolSet = {
      id: s.id,
      name: s.name,
      position: s.position,
      tools: [...(s.tools ?? [])].sort((a, b) => a.position - b.position).map((t) => toolOf(t, urls)),
    };
    if (s.owner_id !== userId) shared.push({ ...set, company: "shared" });
    else own.push(s.company_id ? { ...set, company: "published" } : set);
  }
  shared.sort((a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id));
  return [...shared, ...own];
}

/** A new set after the caller's last one; null when they have MAX_TOOL_SETS already. */
export async function createToolSet(client: Client, userId: string, name: string): Promise<ToolSet | null> {
  const { data: last, error: readError, count } = await client
    .from("tool_sets")
    .select("position", { count: "exact" })
    .eq("owner_id", userId)
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
export async function moveToolSet(client: Client, userId: string, id: string, direction: -1 | 1): Promise<boolean> {
  const { data, error } = await client
    .from("tool_sets")
    .select("id, position")
    .eq("owner_id", userId)
    .order("position")
    .order("created_at")
    .limit(MAX_TOOL_SETS);
  if (error) throw failed("tool_sets select", error);
  const sets = data ?? [];
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

/** Deletes set `id`, its tools and their images; false when the caller has no such set. */
export async function deleteToolSet(client: Client, userId: string, id: string): Promise<boolean> {
  const { data, error } = await client.from("tool_sets").delete().eq("id", id).select("id");
  if (error) throw failed("tool_sets delete", error);
  if ((data ?? []).length === 0) return false;
  // The images go too (best effort: a leftover object is unreachable without its row).
  const folder = `${userId}/${id}`;
  const { data: objects } = await client.storage.from(TOOL_ASSETS).list(folder, { limit: MAX_TOOLS_PER_SET });
  const names = (objects ?? []).map((o) => `${folder}/${o.name}`);
  if (names.length > 0) await client.storage.from(TOOL_ASSETS).remove(names);
  return true;
}

/** Whether `bytes` start like a PNG or a JPEG of `type`. */
export function imageMatches(bytes: Uint8Array, type: "image/png" | "image/jpeg"): boolean {
  if (type === "image/png") return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export type AddedTool = { set: ToolSet | null; setId: string; tool: Tool };

/**
 * Adds a tool to the caller's set (a new one when `input.set` names one), its
 * image uploaded first. Null when the set is not the caller's or the image is
 * not what it says; "full" when the user or the set has no room.
 */
export async function addTool(client: Client, userId: string, input: AddToolInput, newId: () => string): Promise<AddedTool | "full" | null> {
  let bytes: Uint8Array | null = null;
  if (input.image) {
    bytes = new Uint8Array(Buffer.from(input.image.base64, "base64"));
    if (!imageMatches(bytes, input.image.type)) return null;
  }
  let created: ToolSet | null = null;
  let setId: string;
  if ("id" in input.set) {
    const { data, error } = await client.from("tool_sets").select("id").eq("id", input.set.id).eq("owner_id", userId).maybeSingle();
    if (error) throw failed("tool_sets select", error);
    if (!data) return null;
    setId = data.id;
  } else {
    created = await createToolSet(client, userId, input.set.name);
    if (!created) return "full";
    setId = created.id;
  }
  const { data: last, error: lastError, count } = await client
    .from("tools")
    .select("position", { count: "exact" })
    .eq("tool_set_id", setId)
    .order("position", { ascending: false })
    .limit(1);
  if (lastError) throw failed("tools select", lastError);
  if ((count ?? 0) >= MAX_TOOLS_PER_SET) return "full";

  const id = newId();
  let assetPath: string | null = null;
  let imageUrl: string | null = null;
  if (input.image && bytes) {
    assetPath = `${userId}/${setId}/${id}.${input.image.type === "image/png" ? "png" : "jpg"}`;
    const { error: uploadError } = await client.storage.from(TOOL_ASSETS).upload(assetPath, bytes, { contentType: input.image.type, upsert: false });
    if (uploadError) throw failed("tool-assets upload", null);
    const { data: signed } = await client.storage.from(TOOL_ASSETS).createSignedUrl(assetPath, SIGNED_URL_SECONDS);
    imageUrl = signed?.signedUrl ?? null;
  }
  const { error } = await client.from("tools").insert({
    id,
    tool_set_id: setId,
    name: input.name,
    markup: input.content as unknown as NonNullable<Json>,
    device: input.device as unknown as Json,
    asset_path: assetPath,
    position: (last?.[0]?.position ?? 0) + 1,
  });
  if (error) {
    if (assetPath) await client.storage.from(TOOL_ASSETS).remove([assetPath]);
    throw failed("tools insert", error);
  }
  return { set: created, setId, tool: { id, name: input.name, content: input.content, device: input.device, imageUrl } };
}
