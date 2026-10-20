// .btx (Bluebeam Revu tool set) → typed BtxToolSet (framework-free; runs in a
// Web Worker in the browser and directly in Node for tests and the spike
// harness). Untrusted input: every limit in BTX_LIMITS applies (NFR31).
//
// Shape: BluebeamRevuToolSet → Title (hex zlib text) + ToolChestItem*.
// Item: Resources* (ID, Data: hex zlib), Name, Type, Raw (hex zlib PDF
// annotation dictionary), X, Y, Index, Child* (Type, Raw, X, Y, Index), Mode.

import { z } from "zod";

import { BtxError } from "./errors";
import { createInflateBudget, decodeHexValue, decodeText, type InflateBudget } from "./inflate";
import { BTX_LIMITS, type BtxLimits } from "./limits";
import {
  collectRefs,
  getName,
  getText,
  isDict,
  parsePdfObject,
  type PdfDict,
  type PdfObject,
} from "./pdf-object";
import { readXml, type XmlElement } from "./xml";

export type BtxAnnotation = {
  /** Revu class name, e.g. "Bluebeam.PDF.Annotations.AnnotationCircle". */
  type: string;
  /** PDF /Subtype of the dictionary (Stamp, Circle, Line, …, RL). */
  subtype: string | undefined;
  /** /Subj text (the label Revu shows), if any. */
  subject: string | undefined;
  /** The raw annotation dictionary, Revu-private keys included. */
  dict: PdfDict;
  /** Placement offset of this member within the tool (see report: origin = -(X, Y)). */
  x: number;
  y: number;
  index: number | undefined;
  role: "root" | "child";
};

export type BtxItem = {
  /** Revu's item name (in practice a random 16-letter id). */
  name: string;
  type: string;
  mode: string | undefined;
  /** Root first, then children in file order. */
  annotations: BtxAnnotation[];
  /** BBObjPtr id → object (form XObjects, fonts, images, …). */
  resources: Map<string, PdfObject>;
  /** Referenced ids that are not in `resources`. */
  missingRefs: string[];
};

export type BtxToolSet = {
  title: string;
  items: BtxItem[];
  warnings: string[];
};

/** Structured-clone friendly variant (no Map) for worker messages. */
export type BtxItemPlain = Omit<BtxItem, "resources"> & {
  resources: Array<{ id: string; object: PdfObject }>;
};
export type BtxToolSetPlain = Omit<BtxToolSet, "items"> & { items: BtxItemPlain[] };

export type ParseBtxOptions = { limits?: Partial<BtxLimits> };

// ---------------------------------------------------------------- Zod (boundary validation)

const pdfObjectSchema: z.ZodType<PdfObject> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.array(pdfObjectSchema),
    z.object({ kind: z.literal("name"), value: z.string() }),
    z.object({ kind: z.literal("string"), bytes: z.instanceof(Uint8Array), hex: z.boolean() }),
    z.object({ kind: z.literal("ref"), ref: z.string() }),
    pdfDictSchema,
    z.object({ kind: z.literal("stream"), dict: pdfDictSchema, data: z.instanceof(Uint8Array) }),
  ]),
);
const pdfDictSchema: z.ZodType<PdfDict> = z.lazy(() =>
  z.object({
    kind: z.literal("dict"),
    entries: z.array(z.tuple([z.string(), pdfObjectSchema])),
  }),
);

const annotationSchema = z.object({
  type: z.string().min(1),
  subtype: z.string().optional(),
  subject: z.string().optional(),
  dict: pdfDictSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  index: z.number().int().optional(),
  role: z.enum(["root", "child"]),
});

const itemSchema = z.object({
  name: z.string(),
  type: z.string(),
  mode: z.string().optional(),
  annotations: z.array(annotationSchema).min(1),
  resources: z.map(z.string(), pdfObjectSchema),
  missingRefs: z.array(z.string()),
});

export const btxToolSetSchema = z.object({
  title: z.string(),
  items: z.array(itemSchema),
  warnings: z.array(z.string()),
});

// ---------------------------------------------------------------- parse

function structure(message: string): BtxError {
  return new BtxError("structure-invalid", message);
}

function childText(el: XmlElement, name: string): string | undefined {
  const c = el.children.find((x) => x.name === name);
  return c?.text.trim();
}

function parseNumber(text: string | undefined, what: string, itemNo: number): number {
  if (text === undefined || text === "") return 0;
  const n = Number(text);
  if (!Number.isFinite(n)) throw structure(`Item ${itemNo}: ${what} is not a number`);
  return n;
}

type Ctx = {
  budget: InflateBudget;
  limits: BtxLimits;
  warnings: string[];
};

async function decodeAnnotation(
  el: XmlElement,
  role: "root" | "child",
  itemNo: number,
  ctx: Ctx,
): Promise<BtxAnnotation> {
  const rawHex = childText(el, "Raw");
  if (!rawHex) throw structure(`Item ${itemNo}: annotation without Raw`);
  const dict = parsePdfObject(await decodeHexValue(rawHex, ctx.budget, ctx.limits.maxHexChars), {
    maxDepth: ctx.limits.maxPdfDepth,
  });
  if (!isDict(dict)) throw structure(`Item ${itemNo}: Raw is not a dictionary`);
  const indexText = childText(el, "Index");
  return {
    type: childText(el, "Type") ?? "",
    subtype: getName(dict, "Subtype"),
    subject: getText(dict, "Subj"),
    dict,
    x: parseNumber(childText(el, "X"), "X", itemNo),
    y: parseNumber(childText(el, "Y"), "Y", itemNo),
    index: indexText ? Math.trunc(parseNumber(indexText, "Index", itemNo)) : undefined,
    role,
  };
}

const ITEM_ELEMENTS = new Set(["Resources", "Name", "Type", "Raw", "X", "Y", "Index", "Child", "Mode"]);
const CHILD_ELEMENTS = new Set(["Type", "Raw", "X", "Y", "Index"]);

async function decodeItem(el: XmlElement, itemNo: number, ctx: Ctx): Promise<BtxItem> {
  const resources = new Map<string, PdfObject>();
  const annotations: BtxAnnotation[] = [];
  for (const c of el.children) {
    if (!ITEM_ELEMENTS.has(c.name)) {
      ctx.warnings.push(`Item ${itemNo}: unknown element <${c.name}> ignored`);
    }
  }
  for (const r of el.children.filter((c) => c.name === "Resources")) {
    const idHex = childText(r, "ID");
    const dataHex = childText(r, "Data");
    if (!idHex || !dataHex) throw structure(`Item ${itemNo}: Resources without ID or Data`);
    const id = decodeText(await decodeHexValue(idHex, ctx.budget, ctx.limits.maxHexChars)).trim();
    const data = await decodeHexValue(dataHex, ctx.budget, ctx.limits.maxHexChars);
    if (resources.has(id)) ctx.warnings.push(`Item ${itemNo}: duplicate resource id`);
    resources.set(id, parsePdfObject(data, { maxDepth: ctx.limits.maxPdfDepth }));
  }
  annotations.push(await decodeAnnotation(el, "root", itemNo, ctx));
  for (const child of el.children.filter((c) => c.name === "Child")) {
    for (const cc of child.children) {
      if (!CHILD_ELEMENTS.has(cc.name)) {
        ctx.warnings.push(`Item ${itemNo}: unknown element <${cc.name}> in Child ignored`);
      }
    }
    annotations.push(await decodeAnnotation(child, "child", itemNo, ctx));
  }
  return {
    name: childText(el, "Name") ?? "",
    type: childText(el, "Type") ?? "",
    mode: childText(el, "Mode") || undefined,
    annotations,
    resources,
    missingRefs: resolveRefs(annotations, resources),
  };
}

/**
 * Walks the BBObjPtr graph from the annotation dictionaries with an explicit
 * stack and a visited set (cycles terminate, no recursion). Returns the ids
 * that are referenced but missing.
 */
export function resolveRefs(annotations: Array<{ dict: PdfDict }>, resources: Map<string, PdfObject>): string[] {
  const visited = new Set<string>();
  const missing = new Set<string>();
  const stack: string[] = [];
  for (const a of annotations) for (const id of collectRefs(a.dict)) stack.push(id);
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const obj = resources.get(id);
    if (obj === undefined) {
      missing.add(id);
      continue;
    }
    for (const next of collectRefs(obj)) if (!visited.has(next)) stack.push(next);
  }
  return [...missing].sort();
}

/** Parses a .btx file. Throws BtxError on limit or structure violations. */
export async function parseBtx(bytes: Uint8Array, options: ParseBtxOptions = {}): Promise<BtxToolSet> {
  const limits: BtxLimits = { ...BTX_LIMITS, ...options.limits };
  if (bytes.byteLength > limits.maxFileBytes) {
    throw new BtxError("file-too-large", `File larger than ${limits.maxFileBytes} bytes`);
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  const root = readXml(text, { maxDepth: limits.maxXmlDepth });
  if (root.name !== "BluebeamRevuToolSet") throw structure("Not a Revu tool set (unexpected root element)");
  const ctx: Ctx = { budget: createInflateBudget(limits), limits, warnings: [] };

  let title = "";
  const items: BtxItem[] = [];
  for (const el of root.children) {
    if (el.name === "Title") {
      title = decodeText(await decodeHexValue(el.text.trim(), ctx.budget, limits.maxHexChars));
    } else if (el.name === "ToolChestItem") {
      items.push(await decodeItem(el, items.length, ctx));
    } else {
      ctx.warnings.push(`Unknown element <${el.name}> ignored`);
    }
  }
  const result: BtxToolSet = { title, items, warnings: ctx.warnings };
  const checked = btxToolSetSchema.safeParse(result);
  if (!checked.success) throw structure("Parsed tool set failed validation");
  return result;
}

// ---------------------------------------------------------------- plain conversion

export function toPlainToolSet(set: BtxToolSet): BtxToolSetPlain {
  return {
    title: set.title,
    warnings: set.warnings,
    items: set.items.map((it) => ({
      ...it,
      resources: [...it.resources].map(([id, object]) => ({ id, object })),
    })),
  };
}

export function fromPlainToolSet(set: BtxToolSetPlain): BtxToolSet {
  return {
    title: set.title,
    warnings: set.warnings,
    items: set.items.map((it) => ({
      ...it,
      resources: new Map(it.resources.map((r) => [r.id, r.object])),
    })),
  };
}
