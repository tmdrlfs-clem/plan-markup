// .btx (Bluebeam Revu tool set) → typed BtxToolSet (framework-free; runs in a
// Web Worker in the browser and directly in Node for tests and the spike
// harness). Untrusted input: every limit in BTX_LIMITS applies (NFR31).
//
// Shape: BluebeamRevuToolSet → Title (hex zlib text) + ToolChestItem*.
// Item: Resources* (ID, Data: hex zlib), Name, Type, Raw (hex zlib PDF
// annotation dictionary), X, Y, Index, Child* (Type, Raw, X, Y, Index), Mode.

import { z } from "zod";

import { BtxError, type BtxErrorCode } from "./errors";
import { createInflateBudget, decodeHexValue, decodeText, type InflateBudget } from "./inflate";
import { BTX_LIMITS, type BtxLimits } from "./limits";
import {
  collectRefs,
  createPdfNodeBudget,
  getName,
  getText,
  isDict,
  parsePdfObject,
  type PdfDict,
  type PdfNodeBudget,
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

function parseNumber(text: string | undefined, what: string, where: string): number {
  if (text === undefined || text === "") return 0;
  const n = Number(text);
  if (!Number.isFinite(n)) throw structure(`${where}: ${what} is not a number`);
  return n;
}

/**
 * Errors that only invalidate the item they occur in: the item is skipped with
 * a warning. Every other code (limits, XML structure, root) fails the file.
 */
const ITEM_LEVEL_CODES: ReadonlySet<BtxErrorCode> = new Set<BtxErrorCode>([
  "hex-invalid",
  "inflate-failed",
  "pdf-malformed",
  "structure-invalid",
]);

function isItemLevel(e: unknown): e is BtxError {
  return e instanceof BtxError && ITEM_LEVEL_CODES.has(e.code);
}

/** An item-level error with its location ("Item 3 child 1: ..."); other values unchanged. */
function located(e: unknown, where: string): unknown {
  if (!isItemLevel(e) || e.message.startsWith("Item ")) return e;
  return new BtxError(e.code, `${where}: ${e.message}`);
}

type Ctx = {
  budget: InflateBudget;
  nodes: PdfNodeBudget;
  limits: BtxLimits;
  warnings: string[];
  childrenLeft: number;
  resourcesLeft: number;
};

async function decodeAnnotation(
  el: XmlElement,
  role: "root" | "child",
  where: string,
  ctx: Ctx,
): Promise<BtxAnnotation> {
  try {
    const type = childText(el, "Type");
    if (!type) throw structure(`${where}: missing <Type>`);
    const rawHex = childText(el, "Raw");
    if (!rawHex) throw structure(`${where}: annotation without Raw`);
    const dict = parsePdfObject(await decodeHexValue(rawHex, ctx.budget, ctx.limits.maxHexChars), {
      maxDepth: ctx.limits.maxPdfDepth,
      nodeBudget: ctx.nodes,
    });
    if (!isDict(dict)) throw structure(`${where}: Raw is not a dictionary`);
    const indexText = childText(el, "Index");
    return {
      type,
      subtype: getName(dict, "Subtype"),
      subject: getText(dict, "Subj"),
      dict,
      x: parseNumber(childText(el, "X"), "X", where),
      y: parseNumber(childText(el, "Y"), "Y", where),
      index: indexText ? Math.trunc(parseNumber(indexText, "Index", where)) : undefined,
      role,
    };
  } catch (e) {
    throw located(e, where);
  }
}

const ITEM_ELEMENTS = new Set(["Resources", "Name", "Type", "Raw", "X", "Y", "Index", "Child", "Mode"]);
const CHILD_ELEMENTS = new Set(["Type", "Raw", "X", "Y", "Index"]);

/** Count limits for one item; they fail the whole file (checked before decoding). */
function checkItemCounts(el: XmlElement, itemNo: number, ctx: Ctx): void {
  const { limits } = ctx;
  const children = el.children.filter((c) => c.name === "Child").length;
  const resources = el.children.filter((c) => c.name === "Resources").length;
  if (children > limits.maxChildrenPerItem) {
    throw new BtxError("too-many-children", `Item ${itemNo}: more than ${limits.maxChildrenPerItem} Child elements`);
  }
  ctx.childrenLeft -= children;
  if (ctx.childrenLeft < 0) {
    throw new BtxError("too-many-children", `More than ${limits.maxChildrenPerFile} Child elements in the file`);
  }
  if (resources > limits.maxResourcesPerItem) {
    throw new BtxError("too-many-resources", `Item ${itemNo}: more than ${limits.maxResourcesPerItem} Resources`);
  }
  ctx.resourcesLeft -= resources;
  if (ctx.resourcesLeft < 0) {
    throw new BtxError("too-many-resources", `More than ${limits.maxResourcesPerFile} Resources in the file`);
  }
}

async function decodeItem(el: XmlElement, itemNo: number, ctx: Ctx): Promise<BtxItem> {
  const where = `Item ${itemNo}`;
  const resources = new Map<string, PdfObject>();
  const annotations: BtxAnnotation[] = [];
  const warnings: string[] = [];
  for (const c of el.children) {
    if (!ITEM_ELEMENTS.has(c.name)) warnings.push(`${where}: unknown element <${c.name}> ignored`);
  }
  let resourceNo = 0;
  for (const r of el.children.filter((c) => c.name === "Resources")) {
    const resourceWhere = `${where} resource ${resourceNo++}`;
    try {
      const idHex = childText(r, "ID");
      const dataHex = childText(r, "Data");
      if (!idHex || !dataHex) throw structure(`${resourceWhere}: Resources without ID or Data`);
      const id = decodeText(await decodeHexValue(idHex, ctx.budget, ctx.limits.maxHexChars)).trim();
      const data = await decodeHexValue(dataHex, ctx.budget, ctx.limits.maxHexChars);
      if (resources.has(id)) warnings.push(`${where}: duplicate resource id`);
      resources.set(id, parsePdfObject(data, { maxDepth: ctx.limits.maxPdfDepth, nodeBudget: ctx.nodes }));
    } catch (e) {
      throw located(e, resourceWhere);
    }
  }
  annotations.push(await decodeAnnotation(el, "root", where, ctx));
  let childNo = 0;
  for (const child of el.children.filter((c) => c.name === "Child")) {
    const childWhere = `${where} child ${childNo++}`;
    for (const cc of child.children) {
      if (!CHILD_ELEMENTS.has(cc.name)) warnings.push(`${childWhere}: unknown element <${cc.name}> ignored`);
    }
    annotations.push(await decodeAnnotation(child, "child", childWhere, ctx));
  }
  const item: BtxItem = {
    name: childText(el, "Name") ?? "",
    type: annotations[0]!.type,
    mode: childText(el, "Mode") || undefined,
    annotations,
    resources,
    missingRefs: resolveRefs(annotations, resources),
  };
  // Validated per item, so a failure names the item instead of failing the file.
  if (!itemSchema.safeParse(item).success) throw structure(`${where}: failed validation`);
  ctx.warnings.push(...warnings);
  return item;
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

/**
 * Parses a .btx file. Throws BtxError on file-level problems (limits, XML
 * structure, root, Title). A malformed item is skipped with a warning naming
 * its index and the reason; the other items are kept.
 */
export async function parseBtx(bytes: Uint8Array, options: ParseBtxOptions = {}): Promise<BtxToolSet> {
  const limits: BtxLimits = { ...BTX_LIMITS, ...options.limits };
  if (bytes.byteLength > limits.maxFileBytes) {
    throw new BtxError("file-too-large", `File larger than ${limits.maxFileBytes} bytes`);
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  const root = readXml(text, { maxDepth: limits.maxXmlDepth });
  if (root.name !== "BluebeamRevuToolSet") throw structure("Not a Revu tool set (unexpected root element)");
  const ctx: Ctx = {
    budget: createInflateBudget(limits),
    nodes: createPdfNodeBudget(limits.maxPdfNodes),
    limits,
    warnings: [],
    childrenLeft: limits.maxChildrenPerFile,
    resourcesLeft: limits.maxResourcesPerFile,
  };
  const itemCount = root.children.filter((c) => c.name === "ToolChestItem").length;
  if (itemCount > limits.maxItems) {
    throw new BtxError("too-many-items", `More than ${limits.maxItems} items in the file`);
  }

  let title = "";
  const items: BtxItem[] = [];
  let itemNo = 0;
  for (const el of root.children) {
    if (el.name === "Title") {
      title = decodeText(await decodeHexValue(el.text.trim(), ctx.budget, limits.maxHexChars));
    } else if (el.name === "ToolChestItem") {
      // Item numbers count every ToolChestItem in the file, skipped ones included.
      const n = itemNo++;
      checkItemCounts(el, n, ctx);
      try {
        items.push(await decodeItem(el, n, ctx));
      } catch (e) {
        if (!isItemLevel(e)) throw e;
        ctx.warnings.push(`${e.message} (item skipped)`);
      }
    } else {
      ctx.warnings.push(`Unknown element <${el.name}> ignored`);
    }
  }
  return { title, items, warnings: ctx.warnings };
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
