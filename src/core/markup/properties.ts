// Story 5.10: the properties a markup has (FR34) and how a change or a copied
// format applies to it. The Properties panel shows the fields every selected
// markup has; a change applies only to the markups it fits (pure; the editor
// makes it one undo step).

import { isMeasureMarkup, isTextMarkup, type Markup, type MarkupStyle, type MarkupType } from "@/core/schema/markup";

export type PropertyField = "color" | "width" | "fill" | "opacity" | "fontSize" | "text" | "subject";

/** The panel's order. */
export const PROPERTY_FIELDS: readonly PropertyField[] = ["subject", "color", "fill", "width", "opacity", "fontSize", "text"];

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
  strikethrough: "Strikethrough",
};

/** Closed shapes and the text boxes drawn around text: a fill fills them under their stroke. */
const FILLED: ReadonlySet<MarkupType> = new Set<MarkupType>(["polygon", "rectangle", "ellipse", "cloud", "text", "callout", "cloudplus"]);

/** The fields `m` has: an image has only its opacity (and a subject); a typewriter has no frame to give a width. */
export function fieldsOf(m: Markup): ReadonlySet<PropertyField> {
  const fields = new Set<PropertyField>(["subject", "opacity"]);
  if (m.type === "image") return fields;
  fields.add("color");
  if (m.type !== "typewriter") fields.add("width");
  if (FILLED.has(m.type)) fields.add("fill");
  if (isTextMarkup(m) || isMeasureMarkup(m) || m.type === "dimension") fields.add("fontSize");
  if (isTextMarkup(m)) fields.add("text");
  return fields;
}

/** The fields all of `markups` have, in the panel's order; text only for one markup. */
export function sharedFields(markups: readonly Markup[]): PropertyField[] {
  if (markups.length === 0) return [];
  const each = markups.map(fieldsOf);
  return PROPERTY_FIELDS.filter((f) => (f !== "text" || markups.length === 1) && each.every((s) => s.has(f)));
}

/** What a size field is called: "Font size" for text, "Caption size" for measurements and dimensions, "Text size" for both. */
export function sizeLabel(markups: readonly Markup[]): string {
  const text = markups.some(isTextMarkup);
  const caption = markups.some((m) => !isTextMarkup(m));
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
export type PropertyChange = Partial<Omit<MarkupStyle, "fill">> & { fill?: string | null; subject?: string; text?: string };

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
  return next;
}

function sameStyle(a: MarkupStyle, b: MarkupStyle): boolean {
  return a.color === b.color && a.width === b.width && a.fontSize === b.fontSize && a.fill === b.fill && a.opacity === b.opacity;
}

/** The format painter's copy of `m`: its style (D2: not its subject or text). */
export function formatOf(m: Markup): MarkupStyle {
  return { ...m.style };
}

/** `m` with a copied format: the style fields it has (no fill copied: none, when it can have one). */
export function withFormat(m: Markup, format: MarkupStyle): Markup {
  return withChange(m, { color: format.color, width: format.width, fontSize: format.fontSize, opacity: format.opacity ?? 1, fill: format.fill ?? null });
}
