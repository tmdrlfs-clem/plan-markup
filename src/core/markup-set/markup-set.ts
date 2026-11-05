// Story 6.1 (A1, A2): what the client sends to make a file's markup set and to
// save its calibrations, shared by the client and the server actions. Only
// the file's SHA-256, its name and its pages' geometry: never PDF bytes (NFR26).

import { z } from "zod";

import { calibrationSchema } from "@/core/calibration/calibration";
import { UUID_PATTERN } from "@/core/ids/uuid";

export const MAX_PAGES = 10_000;

const coordinate = z.number().finite().min(-1e6).max(1e6);
const size = z.number().finite().positive().max(1e6);

/** A page as the set records it: its /Rotate, its crop box in user space and its size in points. */
export const pageGeometrySchema = z.object({
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  cropBox: z.tuple([coordinate, coordinate, coordinate, coordinate]),
  width: size,
  height: size,
});
export type PageGeometry = z.infer<typeof pageGeometrySchema>;

export const ensureMarkupSetSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  filename: z.string().trim().min(1).max(255),
  pages: z.array(pageGeometrySchema).min(1).max(MAX_PAGES),
});
export type EnsureMarkupSetInput = z.infer<typeof ensureMarkupSetSchema>;

/** The server's ids of a file's markup set; `pageIds` by 0-based page index. */
export type MarkupSetIds = { drawingId: string; fileId: string; pageIds: string[] };

const uuid = z.string().regex(UUID_PATTERN);

/** Calibrations to save by server page id; null removes one. */
export const saveCalibrationsSchema = z
  .array(z.object({ pageId: uuid, calibration: calibrationSchema.nullable() }))
  .min(1)
  .max(MAX_PAGES);
export type CalibrationEntry = z.infer<typeof saveCalibrationsSchema>[number];

/** A page's geometry from what the renderer reports (its /Rotate normalised, its view box or [0, 0, size]). */
export function pageGeometryOf(page: { width: number; height: number; rotate: number; view?: readonly [number, number, number, number] | number[] }): PageGeometry {
  const rotation = ((((Math.round(page.rotate / 90) * 90) % 360) + 360) % 360) as PageGeometry["rotation"];
  const v = page.view;
  return {
    rotation,
    cropBox: v && v.length === 4 ? [v[0], v[1], v[2], v[3]] : [0, 0, page.width, page.height],
    width: page.width,
    height: page.height,
  };
}

/** Filenames over 255 characters keep their end (the extension and the sheet number usually sit there). */
export function setFilename(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim() || "Untitled.pdf";
  return trimmed.length <= 255 ? trimmed : trimmed.slice(trimmed.length - 255);
}
