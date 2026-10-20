// Reference intake: Revu-saved placement PDFs (fixtures/private/btx/reference/<set>.pdf)
// → one reference image per tool. Revu writes an appearance stream for every
// placed markup, so rendering the placed annotation is Revu's own drawing,
// also for items that had no /AP in the .btx.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from "@cantoo/pdf-lib";

import { itemBounds } from "@/core/btx/to-pdf";

import { renderPdf } from "./render.mjs";

const N = (s) => PDFName.of(s);

function text(obj) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  return undefined;
}

function rectOf(dict, doc) {
  const r = doc.context.lookup(dict.get(N("Rect")));
  if (!(r instanceof PDFArray)) return null;
  const v = r.asArray().map((x) => doc.context.lookup(x)).map((x) => (x instanceof PDFNumber ? x.asNumber() : NaN));
  if (v.length < 4 || v.some((x) => !Number.isFinite(x))) return null;
  return [Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3])];
}

/**
 * Placed units of page 1 in /Annots order. A unit is one annotation plus the
 * annotations that join it as a group (/IRT → it, /RT /Group). Popups skipped.
 * Returns [{ refs: PDFRef[], subject, subtype, rect }].
 */
export async function readReferenceUnits(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const page = doc.getPage(0);
  const annots = doc.context.lookup(page.node.get(N("Annots")));
  if (!(annots instanceof PDFArray)) return [];
  const entries = [];
  for (const raw of annots.asArray()) {
    const dict = doc.context.lookup(raw);
    if (!(dict instanceof PDFDict)) continue;
    const subtype = dict.get(N("Subtype"))?.toString().slice(1);
    if (subtype === "Popup") continue;
    entries.push({ ref: raw instanceof PDFRef ? raw : null, dict, subtype });
  }
  const unitOf = new Map();
  const units = [];
  for (const e of entries) {
    const irt = e.dict.get(N("IRT"));
    const rt = e.dict.get(N("RT"))?.toString();
    const parentUnit = irt instanceof PDFRef && rt === "/Group" ? unitOf.get(irt.toString()) : undefined;
    if (parentUnit) {
      parentUnit.refs.push(e.ref);
      parentUnit.dicts.push(e.dict);
      if (e.ref) unitOf.set(e.ref.toString(), parentUnit);
      continue;
    }
    const unit = { refs: [e.ref], dicts: [e.dict], subject: text(e.dict.get(N("Subj"))), subtype: e.subtype };
    units.push(unit);
    if (e.ref) unitOf.set(e.ref.toString(), unit);
  }
  return units.map((u) => {
    let rect = null;
    for (const d of u.dicts) {
      const r = rectOf(d, doc);
      if (!r) continue;
      rect = rect ? [Math.min(rect[0], r[0]), Math.min(rect[1], r[1]), Math.max(rect[2], r[2]), Math.max(rect[3], r[3])] : r;
    }
    return { refs: u.refs.filter(Boolean), subject: u.subject, subtype: u.subtype, rect, members: u.dicts.length };
  });
}

/** Renders one unit alone: other annotations and page content hidden, page cropped to the unit. */
export async function renderReferenceUnit(pdfBytes, unit, { margin = 4 } = {}) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const page = doc.getPage(0);
  page.node.set(N("Annots"), doc.context.obj(unit.refs));
  page.node.delete(N("Contents"));
  page.node.delete(N("Rotate"));
  if (unit.rect) {
    const [x0, y0, x1, y1] = unit.rect;
    page.setMediaBox(x0 - margin, y0 - margin, x1 - x0 + 2 * margin, y1 - y0 + 2 * margin);
    page.node.delete(N("CropBox"));
  }
  const bytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  return renderPdf(bytes);
}

/**
 * Pairs items with reference units. Equal counts → by order. Otherwise by
 * subject + subtype (first unused match), and the mismatch is reported.
 * `items` = [{ subject, subtype, members }]. Returns { pairs: (unitIndex|null)[], note }.
 */
export function matchUnits(items, units) {
  if (items.length === units.length) {
    return { pairs: items.map((_, i) => i), note: null };
  }
  const used = new Set();
  const pairs = items.map((it) => {
    const k = units.findIndex(
      (u, i) => !used.has(i) && u.subject === it.subject && (u.subtype === it.subtype || !u.subtype || !it.subtype),
    );
    if (k < 0) return null;
    used.add(k);
    return k;
  });
  return {
    pairs,
    note: `count mismatch: ${units.length} placed unit(s) vs ${items.length} item(s); matched by subject + type`,
  };
}

/**
 * Placements for a self-made reference PDF: items in a row, 20 pt apart.
 * Items without bounds (no member with a usable /Rect) cannot be placed: they
 * are returned in `skipped` with the reason. Returns { placements, skipped }.
 */
export function layoutPlacements(items, gap = 20) {
  const placements = [];
  const skipped = [];
  let x = 0;
  items.forEach((item, index) => {
    const b = itemBounds(item);
    if (!b) {
      skipped.push({ index, reason: "no member has a usable /Rect" });
      return;
    }
    placements.push({ item, dx: x - b[0], dy: -b[1] });
    x += b[2] - b[0] + gap;
  });
  return { placements, skipped };
}
