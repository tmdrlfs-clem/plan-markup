// Story 7.6 (FR43): a tool set as a file of our own, to back up and share
// between accounts. Framework-free.
//
// A versioned JSON document: the set's name and its tools in order, each with
// its content (Story 7.2's), its device type and its image embedded as the
// base64 of a PNG or JPEG. Reading one is untrusted input: the file's size is
// checked before it is read, then the JSON is validated with Zod (the same
// limits a tool has when added), every image's bytes must be what its type
// says; anything wrong refuses the whole file, so nothing is changed.

import { z } from "zod";

import { MAX_TOOL_SET_NAME, toolSetNameSchema } from "./tool-set";
import { MAX_TOOL_CONTENT_BYTES, deviceSchema, toolContentSchema, toolImageInput, toolNameSchema, type Device, type ToolContent } from "./tool";

export const TOOL_FILE_FORMAT = "plan-markup.tool-set";
export const TOOL_FILE_VERSION = 1;
/** The file name's ending, and what the import picker accepts. */
export const TOOL_FILE_EXTENSION = ".tools.json";
/** At most this many tools in a file (a set's limit). */
export const MAX_TOOL_FILE_TOOLS = 1000;
/** The largest file read (a set of images); checked before it is read. */
export const MAX_TOOL_FILE_BYTES = 64 * 1024 * 1024;

export const NOT_OUR_TOOL_SET = "Not a Plan Markup tool set file";

type ToolImage = z.infer<typeof toolImageInput>;

const fileToolSchema = z
  .object({
    name: toolNameSchema,
    device: deviceSchema.nullable(),
    content: toolContentSchema,
    image: toolImageInput.nullable(),
  })
  .superRefine((t, ctx) => {
    const images = t.content.markups.some((m) => m.type === "image");
    if (images !== (t.image !== null)) ctx.addIssue({ code: "custom", message: "A tool's image is missing." });
    if (new TextEncoder().encode(JSON.stringify(t.content)).length > MAX_TOOL_CONTENT_BYTES) ctx.addIssue({ code: "custom", message: "A tool's markups are too large." });
    if (t.image && !imageMatches(t.image)) ctx.addIssue({ code: "custom", message: "A tool's image is not a PNG or JPEG." });
  });

export const toolFileSchema = z.object({
  format: z.literal(TOOL_FILE_FORMAT),
  version: z.literal(TOOL_FILE_VERSION),
  exportedAt: z.string().max(40),
  set: z.object({
    name: toolSetNameSchema,
    tools: z.array(fileToolSchema).max(MAX_TOOL_FILE_TOOLS),
  }),
});
export type ToolFile = z.infer<typeof toolFileSchema>;
export type ToolFileTool = ToolFile["set"]["tools"][number];

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

/** Whether the image's first bytes are its type's signature. */
export function imageMatches(image: ToolImage): boolean {
  let head: string;
  try {
    head = atob(image.base64.slice(0, 12));
  } catch {
    return false;
  }
  const sig = image.type === "image/png" ? PNG : JPEG;
  return sig.every((b, i) => head.charCodeAt(i) === b);
}

/** The file of a set: its readable tools (`image(i)`: the i-th tool's embedded image, or null). */
export function toolFileOf(
  set: { name: string; tools: readonly { name: string; content: ToolContent | null; device: Device | null }[] },
  images: readonly (ToolImage | null)[],
  exportedAt: string,
): { file: ToolFile; skipped: string[] } {
  const tools: ToolFileTool[] = [];
  const skipped: string[] = [];
  set.tools.forEach((t, i) => {
    const image = images[i] ?? null;
    const needsImage = t.content?.markups.some((m) => m.type === "image") ?? false;
    if (!t.content || needsImage !== (image !== null)) skipped.push(t.name);
    else tools.push({ name: t.name, device: t.device, content: t.content, image });
  });
  return { file: { format: TOOL_FILE_FORMAT, version: TOOL_FILE_VERSION, exportedAt, set: { name: set.name.slice(0, MAX_TOOL_SET_NAME), tools } }, skipped };
}

/** The file's name: the set's name made safe for a file system, and the extension. */
export function toolFileName(setName: string): string {
  const safe = setName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${safe || "Tool set"}${TOOL_FILE_EXTENSION}`;
}

/** Why a file was refused, or the file. */
export function readToolFile(text: string): { ok: true; file: ToolFile } | { ok: false; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "The file is not JSON." };
  }
  const head = z.object({ format: z.literal(TOOL_FILE_FORMAT), version: z.number() }).safeParse(json);
  if (!head.success) return { ok: false, reason: "The file is not a tool set exported from Plan Markup." };
  if (head.data.version !== TOOL_FILE_VERSION) return { ok: false, reason: `The file is version ${head.data.version}; this app reads version ${TOOL_FILE_VERSION}.` };
  const parsed = toolFileSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const at = issue?.path[0] === "set" && issue.path[1] === "tools" && typeof issue.path[2] === "number" ? `Tool ${issue.path[2] + 1}: ` : "";
    return { ok: false, reason: `${at}${issue?.message ?? "The file is not valid."}` };
  }
  return { ok: true, file: parsed.data };
}
