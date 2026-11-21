// Story 5.10: the properties a markup has (FR34) and how a change or a copied
// format applies to it. The Properties panel shows the fields every selected
// markup has; a change applies only to the markups it fits (pure; the editor
// makes it one undo step).

import { isLink } from "./link";
import { isMeasureMarkup, isTextMarkup, legendMetaSchema, revisionMetaSchema, type LegendMeta, type Markup, type MarkupStyle, type MarkupType, type RevisionMeta } from "@/core/schema/markup";

export type PropertyField = "color" | "width" | "fill" | "opacity" | "fontSize" | "text" | "subject" | "revision" | "legend" | "link" | "attachment";

/** The panel's order. */
export const PROPERTY_FIELDS: readonly PropertyField[] = ["subject", "revision", "legend", "link", "attachment", "color", "fill", "width", "opacity", "fontSize", "text"];

/** The default subject: the type's name. */
export const SUBJECT_NAMES: Record<MarkupType, string> = {
  length: "Length",
  polylength: "Polylength",
  area: "Area",
  count: "Count",
  angle: "Angle",
  radius: "Radius",
  diameter: "Diameter",
  line: "Line",
  arrow: "Arrow",
  polyline: "Polyline",
  polygon: "Polygon",
  arc: "Arc",
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  cloud: "Cloud",
  text: "Text box",
  typewriter: "Typewriter",
  note: "Note",
  callout: "Callout",
  cloudplus: "Cloud+",
  pen: "Pen",
  highlight: "Highlight",
  image: "Image",
  dimension: "Dimension",
  underline: "Underline",
  texthighlight: "Text highlight",
  squiggly: "Squiggly",
  caret: "Insert text",
  link: "Link",
  attachment: "Attachment",
  strikethrough: "Strikethrough",
  whiteout: "White-out",
  eraser: "Eraser",
  revision: "Revision stamp",
  legend: "Legend",
  zone: "Zone",
};

/** Closed shapes and the text boxes drawn around text: a fill fills them under their stroke. */
const FILLED: ReadonlySet<MarkupType> = new Set<MarkupType>(["polygon", "rectangle", "ellipse", "cloud", "text", "callout", "cloudplus", "revision", "legend"]);

/** The fields `m` has: an image has only its opacity (and a subject); a typewriter has no frame to give a width. */
export function fieldsOf(m: Markup): ReadonlySet<PropertyField> {
  // Story 5.11 (D3): a cover stays opaque white; an eraser's brush width can change.
  if (m.type === "whiteout") return new Set<PropertyField>(["subject"]);
  if (m.type === "eraser") return new Set<PropertyField>(["subject", "width"]);
  // A link: its address (its box is only a hint on screen).
  if (m.type === "link") return new Set<PropertyField>(["subject", "link"]);
  // A file attachment: its file (name, size, Save file) and its paperclip's colour.
  if (m.type === "attachment") return new Set<PropertyField>(["subject", "attachment", "color", "opacity"]);
  const fields = new Set<PropertyField>(["subject", "opacity"]);
  if (m.type === "image") return fields;
  fields.add("color");
  if (m.type !== "typewriter") fields.add("width");
  if (FILLED.has(m.type)) fields.add("fill");
  if (isTextMarkup(m) || isMeasureMarkup(m) || m.type === "dimension" || m.type === "revision") fields.add("fontSize");
  // Story 7.7: a revision stamp's revision, description, author and date.
  if (m.type === "revision") fields.add("revision");
  // Story 7.8: a legend's title and scope (its text is sized to its box, so no font size).
  if (m.type === "legend") fields.add("legend");
  if (isTextMarkup(m) || m.type === "caret" || (m.type === "strikethrough" && m.replacement !== undefined)) fields.add("text");
  return fields;
}

/** The fields all of `markups` have, in the panel's order; text only for one markup. */
export function sharedFields(markups: readonly Markup[]): PropertyField[] {
  if (markups.length === 0) return [];
  const each = markups.map(fieldsOf);
  return PROPERTY_FIELDS.filter((f) => ((f !== "text" && f !== "revision" && f !== "legend" && f !== "link" && f !== "attachment") || markups.length === 1) && each.every((s) => s.has(f)));
}

/** What a size field is called: "Font size" for text, "Caption size" for measurements and dimensions, "Text size" for both. */
export function sizeLabel(markups: readonly Markup[]): string {
  const isText = (m: Markup) => isTextMarkup(m) || m.type === "revision";
  const text = markups.some(isText);
  const caption = markups.some((m) => !isText(m));
  return text && caption ? "Text size" : text ? "Font size" : "Caption size";
}

/** The value all of `markups` share, or `mixed` when they differ. */
export function sharedValue<T>(markups: readonly Markup[], get: (m: Markup) => T, mixed: T): T {
  if (markups.length === 0) return mixed;
  const first = get(markups[0]);
  return markups.every((m) => get(m) === first) ? first : mixed;
}

/** A markup's subject: its own, else its type's name. */
export function subjectOf(m: Markup): string {
  return m.subject ?? SUBJECT_NAMES[m.type];
}

/** A change from the panel: style fields (fill null: none), the subject (empty: the type's name), the text. */
export type PropertyChange = Partial<Omit<MarkupStyle, "fill" | "font" | "align">> & {
  /** A link's address (kept only when it is a web or mail link). */
  uri?: string;
  fill?: string | null;
  /** null: the app's own face. */
  font?: MarkupStyle["font"] | null;
  /** null: left. */
  align?: MarkupStyle["align"] | null; subject?: string; text?: string; revision?: Partial<RevisionMeta>; legend?: Partial<LegendMeta> };

/** `m` with the change's fields it has (the others are left alone); the same object when nothing changes. */
export function withChange(m: Markup, change: PropertyChange): Markup {
  const fields = fieldsOf(m);
  const style: MarkupStyle = { ...m.style };
  if (change.color !== undefined && fields.has("color")) style.color = change.color;
  if (change.width !== undefined && fields.has("width")) style.width = change.width;
  if (change.fontSize !== undefined && fields.has("fontSize")) style.fontSize = change.fontSize;
  if (change.opacity !== undefined) {
    if (change.opacity >= 1) delete style.opacity;
    else style.opacity = change.opacity;
  }
  // Text format bar: the face and format of a markup with text (a note's text is in its popup: none).
  if (hasTextFormat(m)) {
    if (change.font !== undefined) setOr(style, "font", change.font ?? undefined);
    for (const k of ["bold", "italic", "underline", "strike"] as const) if (change[k] !== undefined) setOr(style, k, change[k] || undefined);
    if (change.align !== undefined) setOr(style, "align", change.align ?? undefined);
  }
  if (change.fill !== undefined && fields.has("fill")) {
    if (change.fill === null) delete style.fill;
    else style.fill = change.fill;
  }
  let next: Markup = sameStyle(style, m.style) ? m : { ...m, style };
  if (change.subject !== undefined) {
    const subject = change.subject.trim();
    const own = subject === "" || subject === SUBJECT_NAMES[m.type] ? undefined : subject;
    if (own !== m.subject) {
      next = { ...next };
      if (own === undefined) delete next.subject;
      else next.subject = own;
    }
  }
  if (change.text !== undefined && isTextMarkup(next) && next.text !== change.text) next = { ...next, text: change.text };
  // Insert text's text; Replace text's replacement (the struck text stays what the PDF says).
  if (change.uri !== undefined && next.type === "link" && next.uri !== change.uri && isLink(change.uri)) next = { ...next, uri: change.uri };
  if (change.text !== undefined && next.type === "caret" && next.text !== change.text) next = { ...next, text: change.text };
  if (change.text !== undefined && next.type === "strikethrough" && next.replacement !== undefined && next.replacement !== change.text) next = { ...next, replacement: change.text };
  // Story 7.7: a stamp's fields, kept only when they still make a valid stamp.
  if (change.revision !== undefined && next.type === "revision") {
    const parsed = revisionMetaSchema.safeParse({ ...next.revision, ...change.revision });
    const r = parsed.success ? parsed.data : null;
    const was = next.revision;
    if (r && (r.rev !== was.rev || r.description !== was.description || r.author !== was.author || r.date !== was.date)) next = { ...next, revision: r };
  }
  // Story 7.8: a legend's title and scope, kept only when valid.
  if (change.legend !== undefined && next.type === "legend") {
    const parsed = legendMetaSchema.safeParse({ ...next.legend, ...change.legend });
    const l = parsed.success ? parsed.data : null;
    if (l && (l.title !== next.legend.title || l.scope !== next.legend.scope)) next = { ...next, legend: l };
  }
  return next;
}

function sameStyle(a: MarkupStyle, b: MarkupStyle): boolean {
  return (
    a.color === b.color &&
    a.width === b.width &&
    a.fontSize === b.fontSize &&
    a.fill === b.fill &&
    a.opacity === b.opacity &&
    a.font === b.font &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.align === b.align
  );
}

/** Sets `key` to `value`, or removes it when `value` is undefined. */
function setOr<K extends keyof MarkupStyle>(style: MarkupStyle, key: K, value: MarkupStyle[K] | undefined): void {
  if (value === undefined) delete style[key];
  else style[key] = value;
}

/** Whether `m` shows text the format bar can format (a text box, typewriter, callout or Cloud+). */
export function hasTextFormat(m: Markup): boolean {
  return m.type === "text" || m.type === "typewriter" || m.type === "callout" || m.type === "cloudplus";
}

/** The format painter's copy of `m`: its style (D2: not its subject or text). */
export function formatOf(m: Markup): MarkupStyle {
  return { ...m.style };
}

/** `m` with a copied format: the style fields it has (no fill copied: none, when it can have one). */
export function withFormat(m: Markup, format: MarkupStyle): Markup {
  return withChange(m, {
    color: format.color,
    width: format.width,
    fontSize: format.fontSize,
    opacity: format.opacity ?? 1,
    fill: format.fill ?? null,
    font: format.font ?? null,
    align: format.align ?? null,
    bold: format.bold ?? false,
    italic: format.italic ?? false,
    underline: format.underline ?? false,
    strike: format.strike ?? false,
  });
}
