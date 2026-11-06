// Story 6.2 (A4, AR10): markups as the server stores them and the ops that save
// them, shared by the client and the server action. Framework-free.
//
// A markup is saved as its type, its page and three fields: `geometry` (where
// it is), `style` and `props` (everything else), plus `z`, its drawing order.
// The client diffs its markups against what it last saved and sends ops
// `{ opId, markupId, kind, type, pageId?, fields?, baseVersion, clientTs }`;
// the server applies field-level last-write-wins (supabase migration
// 20261107090000_markups.sql).

import { z } from "zod";

import { UUID_PATTERN } from "@/core/ids/uuid";
import { markupSchema, markupStyleSchema, type Markup, type MarkupStyle } from "@/core/schema/markup";

/** The markup keys that say where it is. */
export const GEOMETRY_KEYS = ["points", "holes", "captionOffset"] as const;
/** The keys that are columns of their own, in no field. */
const OWN_KEYS = new Set(["id", "type", "pageId", "style"]);
const GEOMETRY = new Set<string>(GEOMETRY_KEYS);

export const MARKUP_FIELDS = ["geometry", "style", "props", "z"] as const;
export type MarkupField = (typeof MARKUP_FIELDS)[number];

/** The most ops in one call (a select-all delete of the largest page). */
export const MAX_OPS = 10_000;

type PartSchemas = { geometry: z.ZodType<Record<string, unknown>>; props: z.ZodType<Record<string, unknown>> };

/** Per markup type: the strict schemas of its geometry and its props, from the markup schema (one source). */
const PART_SCHEMAS: ReadonlyMap<string, PartSchemas> = new Map(
  markupSchema.options.map((option) => {
    const shape = option.shape as Record<string, z.ZodType>;
    const geometry: Record<string, z.ZodType> = {};
    const props: Record<string, z.ZodType> = {};
    for (const [key, schema] of Object.entries(shape)) {
      if (OWN_KEYS.has(key)) continue;
      (GEOMETRY.has(key) ? geometry : props)[key] = schema;
    }
    return [
      option.shape.type.value,
      { geometry: z.strictObject(geometry) as z.ZodType<Record<string, unknown>>, props: z.strictObject(props) as z.ZodType<Record<string, unknown>> },
    ];
  }),
);

/** Every markup type. */
export const MARKUP_TYPES: readonly string[] = [...PART_SCHEMAS.keys()];

/** A markup as saved: its own columns and its fields. */
export type MarkupRow = {
  id: string;
  type: Markup["type"];
  pageId: string;
  geometry: Record<string, unknown>;
  style: MarkupStyle;
  props: Record<string, unknown>;
};

/** A markup split into its columns and fields (undefined values are left out). */
export function splitMarkup(markup: Markup): MarkupRow {
  const geometry: Record<string, unknown> = {};
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(markup)) {
    if (OWN_KEYS.has(key) || value === undefined) continue;
    (GEOMETRY.has(key) ? geometry : props)[key] = value;
  }
  return { id: markup.id, type: markup.type, pageId: markup.pageId, geometry, style: markup.style, props };
}

/** The markup a saved row is, or null when it is not a valid markup (a row written by hand is skipped). */
export function joinMarkup(row: { id: string; type: string; pageId: string; geometry: unknown; style: unknown; props: unknown }): Markup | null {
  const parts = [row.geometry, row.props];
  if (parts.some((p) => typeof p !== "object" || p === null || Array.isArray(p))) return null;
  const parsed = markupSchema.safeParse({ ...(row.props as object), ...(row.geometry as object), id: row.id, type: row.type, pageId: row.pageId, style: row.style });
  return parsed.success ? parsed.data : null;
}

const uuid = z.string().regex(UUID_PATTERN);
const jsonObject = z.record(z.string(), z.unknown());
const zValue = z.number().finite().min(-1e300).max(1e300);

export const markupOpFieldsSchema = z.strictObject({
  geometry: jsonObject.optional(),
  style: jsonObject.optional(),
  props: jsonObject.optional(),
  z: zValue.optional(),
});
export type MarkupOpFields = { geometry?: Record<string, unknown>; style?: MarkupStyle; props?: Record<string, unknown>; z?: number };

export const markupOpSchema = z
  .strictObject({
    opId: uuid,
    markupId: uuid,
    kind: z.enum(["create", "update", "delete"]),
    type: z.string().max(32),
    /** The server page id (create). */
    pageId: uuid.optional(),
    fields: markupOpFieldsSchema.optional(),
    /** The markup's server version the client last knew (0: none). */
    baseVersion: z.number().int().min(0).max(2 ** 31 - 1),
    /** When the change was made, in client ms. */
    clientTs: z.number().int().min(0).max(1e15),
  })
  .superRefine((op, ctx) => {
    const parts = PART_SCHEMAS.get(op.type);
    if (!parts) {
      ctx.addIssue({ code: "custom", path: ["type"], message: "unknown markup type" });
      return;
    }
    const fields = op.fields ?? {};
    const set = MARKUP_FIELDS.filter((f) => fields[f] !== undefined);
    if (op.kind === "create" && (set.length !== MARKUP_FIELDS.length || !op.pageId)) ctx.addIssue({ code: "custom", message: "a create sets its page and every field" });
    if (op.kind === "update" && set.length === 0) ctx.addIssue({ code: "custom", message: "an update sets a field" });
    if (op.kind === "delete" && set.length > 0) ctx.addIssue({ code: "custom", message: "a delete sets no field" });
    if (fields.geometry !== undefined && !parts.geometry.safeParse(fields.geometry).success) ctx.addIssue({ code: "custom", path: ["fields", "geometry"], message: "invalid geometry" });
    if (fields.style !== undefined && !markupStyleSchema.strict().safeParse(fields.style).success) ctx.addIssue({ code: "custom", path: ["fields", "style"], message: "invalid style" });
    if (fields.props !== undefined && !parts.props.safeParse(fields.props).success) ctx.addIssue({ code: "custom", path: ["fields", "props"], message: "invalid props" });
  });
export type MarkupOp = Omit<z.infer<typeof markupOpSchema>, "fields"> & { fields?: MarkupOpFields };

export const applyMarkupOpsSchema = z.strictObject({ drawingId: uuid, ops: z.array(markupOpSchema).min(1).max(MAX_OPS) });
export type ApplyMarkupOpsInput = { drawingId: string; ops: MarkupOp[] };

export const markupOpResultSchema = z.object({
  opId: uuid,
  markupId: uuid,
  /** applied: written (or a replay); deleted: the markup is a tombstone (the op's delete, or a tombstone that won); missing: unknown to the server. */
  status: z.enum(["applied", "deleted", "missing"]),
  /** The markup's server version after the op (0: none). */
  version: z.number().int().min(0),
});
export type MarkupOpResult = z.infer<typeof markupOpResultSchema>;

// ---------------------------------------------------------------------------
// Diff: what changed since the last save.
// ---------------------------------------------------------------------------

/** JSON with sorted keys, so equal values compare equal whatever their key order. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A 53-bit hash of a string (cyrb53), in base 36: compact enough to keep per markup in sessionStorage. */
export function hashString(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * A markup as last saved (or queued): its type, order key and a hash of each
 * field; `markup` is the object itself while in memory (an unchanged object
 * is not hashed again), absent when read back from storage.
 */
export type SavedMarkup = { type: Markup["type"]; z: number; geometry: string; style: string; props: string; markup?: Markup };

export const savedMarkupSchema = z.object({
  type: z.string().max(32),
  z: z.number(),
  geometry: z.string().max(16),
  style: z.string().max(16),
  props: z.string().max(16),
});

export type MarkupChange =
  | { kind: "create"; row: MarkupRow; z: number }
  | { kind: "update"; id: string; type: Markup["type"]; fields: MarkupOpFields }
  | { kind: "delete"; id: string; type: Markup["type"] };

/** Indexes of a longest strictly increasing subsequence of `values` (undefined entries are skipped). */
function longestIncreasing(values: readonly (number | undefined)[]): Set<number> {
  const tails: number[] = []; // index into values of the smallest tail of each length
  const prev = new Array<number>(values.length).fill(-1);
  values.forEach((v, i) => {
    if (v === undefined) return;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((values[tails[mid]] as number) < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  });
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(i);
  return keep;
}

/**
 * Order keys for a list, given each item's previous key (undefined: new). The
 * longest run still in order keeps its keys; the others get keys between their
 * neighbours, so a move or an insert changes only the markups that moved.
 * When doubles run out between two neighbours, every item is renumbered.
 */
export function orderKeys(previous: readonly (number | undefined)[]): number[] {
  const keep = longestIncreasing(previous);
  const next = new Array<number | undefined>(previous.length);
  for (let i = previous.length - 1, hi: number | undefined; i >= 0; i--) {
    next[i] = hi;
    if (keep.has(i)) hi = previous[i];
  }
  const out: number[] = [];
  let lo: number | undefined;
  for (let i = 0; i < previous.length; i++) {
    let key: number;
    if (keep.has(i)) key = previous[i] as number;
    else {
      const hi = next[i];
      key = lo === undefined ? (hi === undefined ? 0 : hi - 1) : hi === undefined ? lo + 1 : (lo + hi) / 2;
      if ((lo !== undefined && !(key > lo)) || (hi !== undefined && !(key < hi)) || !Number.isFinite(key)) return previous.map((_, j) => j);
    }
    out.push(key);
    lo = key;
  }
  return out;
}

/** A saved entry for `markup` at `z`. */
export function savedMarkup(markup: Markup, z: number): SavedMarkup {
  const row = splitMarkup(markup);
  return { type: markup.type, z, geometry: hashString(stableJson(row.geometry)), style: hashString(stableJson(row.style)), props: hashString(stableJson(row.props)), markup };
}

/**
 * The changes from `saved` (what the server has, by id) to `current` (the
 * document's markups in drawing order), and what will be saved once they are.
 * A markup kept as the same object is unchanged; others compare field by field.
 */
export function diffMarkups(saved: ReadonlyMap<string, SavedMarkup>, current: readonly Markup[]): { changes: MarkupChange[]; next: Map<string, SavedMarkup> } {
  const keys = orderKeys(current.map((m) => saved.get(m.id)?.z));
  const changes: MarkupChange[] = [];
  const next = new Map<string, SavedMarkup>();
  current.forEach((markup, i) => {
    const was = saved.get(markup.id);
    const z = keys[i];
    if (!was) {
      const entry = savedMarkup(markup, z);
      next.set(markup.id, entry);
      changes.push({ kind: "create", row: splitMarkup(markup), z });
      return;
    }
    if (was.markup === markup) {
      next.set(markup.id, was.z === z ? was : { ...was, z });
      if (was.z !== z) changes.push({ kind: "update", id: markup.id, type: markup.type, fields: { z } });
      return;
    }
    const entry = savedMarkup(markup, z);
    next.set(markup.id, entry);
    const row = splitMarkup(markup);
    const fields: MarkupOpFields = {};
    if (entry.geometry !== was.geometry) fields.geometry = row.geometry;
    if (entry.style !== was.style) fields.style = row.style;
    if (entry.props !== was.props) fields.props = row.props;
    if (z !== was.z) fields.z = z;
    if (Object.keys(fields).length > 0) changes.push({ kind: "update", id: markup.id, type: markup.type, fields });
  });
  for (const [id, was] of saved) if (!next.has(id)) changes.push({ kind: "delete", id, type: was.type });
  return { changes, next };
}
