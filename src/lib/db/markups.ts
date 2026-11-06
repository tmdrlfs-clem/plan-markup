import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { calibrationSchema, type Calibration } from "@/core/calibration/calibration";
import { joinMarkup, markupOpResultSchema, type ApplyMarkupOpsInput, type MarkupOpResult } from "@/core/markup-set/markup-ops";
import type { MarkupSetIds } from "@/core/markup-set/markup-set";
import type { Markup } from "@/core/schema/markup";
import type { Database, Json } from "./types.gen";

// Story 6.2 (AR7): markup ops to `apply_markup_ops` and its results back. The
// ops already use the RPC's JSON names (camelCase inside jsonb); the only
// snake_case here is the RPC's own arguments. Runs as the caller (the RPC
// re-checks access); errors carry the SQLSTATE only.

/** A refused call: SQLSTATE `42501` → forbidden, `22023` → invalid, `PT429` → rate limited. */
export class MarkupOpsError extends Error {
  constructor(readonly code: "FORBIDDEN" | "INVALID_INPUT" | "RATE_LIMITED" | "INTERNAL", sqlState: string) {
    super(`apply_markup_ops failed: ${sqlState}`);
    this.name = "MarkupOpsError";
  }
}

function codeOf(sqlState: string | undefined): MarkupOpsError["code"] {
  if (sqlState === "42501") return "FORBIDDEN";
  if (sqlState === "22023") return "INVALID_INPUT";
  if (sqlState === "PT429") return "RATE_LIMITED";
  return "INTERNAL";
}

/** Applies `ops` to the drawing's markups, in order; one result per op. */
export async function applyMarkupOps(client: SupabaseClient<Database>, input: ApplyMarkupOpsInput): Promise<MarkupOpResult[]> {
  const { data, error } = await client.rpc("apply_markup_ops", { p_drawing_id: input.drawingId, p_ops: input.ops as unknown as Json });
  if (error) throw new MarkupOpsError(codeOf(error.code), error.code ?? "unknown");
  const parsed = z.array(markupOpResultSchema).length(input.ops.length).safeParse(data);
  if (!parsed.success) throw new MarkupOpsError("INTERNAL", "bad_result");
  return parsed.data;
}

/** Story 6.4: a markup set as the server has it, by the client's page keys (`<sha256>:<index>`). */
export type LoadedMarkupSet = {
  ids: MarkupSetIds;
  /** Live markups in drawing order, with their order key and server version. */
  markups: { markup: Markup; z: number; version: number }[];
  /** Calibrations by client page key. */
  calibrations: Record<string, Calibration>;
};

/** Rows read per request (PostgREST caps a response at 1000 rows). */
const PAGE_ROWS = 1000;

/**
 * Story 6.4 (FR50): the caller's markup set of the file with this SHA-256, or
 * null when there is none. RLS limits every read to the caller's own sets.
 * Rows that are not valid markups (written around the app) are skipped.
 */
export async function loadMarkupSet(client: SupabaseClient<Database>, sha256: string): Promise<LoadedMarkupSet | null> {
  const fail = (what: string, error: { code?: string } | null) => new Error(`load ${what} failed: ${error?.code ?? "unknown"}`);
  const file = await client.from("drawing_files").select("id, drawing_id").eq("sha256", sha256).order("created_at").limit(1).maybeSingle();
  if (file.error) throw fail("file", file.error);
  if (!file.data) return null;
  const { id: fileId, drawing_id: drawingId } = file.data;

  const pageIds: string[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const pages = await client.from("pages").select("id, index").eq("drawing_file_id", fileId).order("index").range(from, from + PAGE_ROWS - 1);
    if (pages.error) throw fail("pages", pages.error);
    for (const p of pages.data) pageIds[p.index] = p.id;
    if (pages.data.length < PAGE_ROWS) break;
  }
  const keyOf = new Map(pageIds.map((id, index) => [id, `${sha256}:${index}`]));

  const markups: LoadedMarkupSet["markups"] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const rows = await client
      .from("markups")
      .select("id, type, page_id, geometry, style, props, z, version")
      .eq("drawing_id", drawingId)
      .is("deleted_at", null)
      .order("z")
      .order("id")
      .range(from, from + PAGE_ROWS - 1);
    if (rows.error) throw fail("markups", rows.error);
    for (const r of rows.data) {
      const pageKey = keyOf.get(r.page_id);
      const markup = pageKey ? joinMarkup({ id: r.id, type: r.type, pageId: pageKey, geometry: r.geometry, style: r.style, props: r.props }) : null;
      if (markup) markups.push({ markup, z: r.z, version: r.version });
    }
    if (rows.data.length < PAGE_ROWS) break;
  }

  const calibrations: Record<string, Calibration> = {};
  const cals = await client
    .from("calibrations")
    .select("page_id, calibration, pages!calibrations_page_id_fkey!inner(drawing_file_id)")
    .eq("pages.drawing_file_id", fileId)
    .limit(10_000);
  if (cals.error) throw fail("calibrations", cals.error);
  for (const c of cals.data) {
    const key = keyOf.get(c.page_id);
    const parsed = calibrationSchema.safeParse(c.calibration);
    if (key && parsed.success) calibrations[key] = parsed.data;
  }

  return { ids: { drawingId, fileId, pageIds }, markups, calibrations };
}

/** Stories 6.5 / 6.6 (FR51): one of the caller's markup sets as listed. */
export type MarkupSetSummary = {
  drawingId: string;
  title: string;
  filename: string;
  sha256: string;
  pageCount: number;
  markupCount: number;
  /** ISO time of the newest change to the set, its markups or calibrations. */
  lastModified: string;
};

/** The caller's markup sets, newest change first (at most 1000). */
export async function listMarkupSets(client: SupabaseClient<Database>): Promise<MarkupSetSummary[]> {
  const { data, error } = await client.rpc("list_markup_sets");
  if (error) throw new Error(`list_markup_sets failed: ${error.code ?? "unknown"}`);
  return (data ?? []).map((r) => ({
    drawingId: r.drawing_id,
    title: r.title,
    filename: r.filename,
    sha256: r.sha256,
    pageCount: r.page_count,
    markupCount: r.markup_count,
    lastModified: r.last_modified,
  }));
}

/** Story 6.5 (FR81): whether the caller has a set of a file with this name but other bytes. */
export async function hasOtherVersion(client: SupabaseClient<Database>, sha256: string, filename: string): Promise<boolean> {
  const { data, error } = await client.from("drawing_files").select("id").eq("filename", filename).neq("sha256", sha256).limit(1);
  if (error) throw new Error(`other version lookup failed: ${error.code ?? "unknown"}`);
  return (data ?? []).length > 0;
}
