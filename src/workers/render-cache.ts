// The render worker's raster cache: src/lib/idb/tile-cache.ts plus PNG <->
// ImageBitmap (Story 3.1). Stored document metadata is validated on the way
// out, so a corrupt or old entry is a miss, never a crash.

import { z } from "zod";
import { MAX_PAGE_LABEL_LENGTH } from "@/core/pdf/sheet-label";
import type { TextItem } from "@/core/search/page-text";
import { openTileCache, type TileCache } from "@/lib/idb/tile-cache";
import type { DocMeta, RasterCache } from "./render.worker";

const flags = z.object({ hasVector: z.boolean(), hasText: z.boolean(), imageOnly: z.boolean() });
const docMetaSchema = z.object({
  pages: z
    .array(z.object({ width: z.number().positive(), height: z.number().positive(), rotate: z.number().int() }))
    .min(1)
    .max(100_000),
  content: z.array(flags.nullable()),
  pageLabels: z.array(z.string().max(MAX_PAGE_LABEL_LENGTH)).nullable().optional(),
  sheetLabels: z.record(z.string().regex(/^\d+$/), z.string().max(100).nullable()).optional(),
});

export function parseDocMeta(value: unknown): DocMeta | null {
  const parsed = docMetaSchema.safeParse(value);
  if (!parsed.success || parsed.data.content.length !== parsed.data.pages.length) return null;
  const { pageLabels } = parsed.data;
  // Labels that do not match the pages are dropped (read again from the PDF), not the whole entry.
  if (pageLabels && pageLabels.length !== parsed.data.pages.length) return { ...parsed.data, pageLabels: undefined };
  return parsed.data;
}

const finite = z.number().finite();
const textItemsSchema = z
  .array(
    z.object({
      str: z.string().max(100_000),
      x: finite,
      y: finite,
      width: finite,
      fontSize: finite,
      quad: z.tuple([finite, finite, finite, finite, finite, finite, finite, finite]),
      eol: z.boolean(),
    }),
  )
  .max(1_000_000);

/** A page's stored text items (Story 3.6), or null when the entry is corrupt or from another version. */
export function parseTextItems(value: unknown): TextItem[] | null {
  const parsed = textItemsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Wraps a TileCache for bitmaps; `decode` turns a stored blob into a bitmap. Text items are stored as JSON. */
export function rasterCache<B>(cache: TileCache, decode: (blob: Blob) => Promise<B>): RasterCache<B> {
  return {
    getText: async (key) => {
      const blob = await cache.getTile(key);
      if (!blob) return null;
      try {
        return parseTextItems(JSON.parse(await blob.text()));
      } catch {
        return null;
      }
    },
    putText: (key, items) => cache.putTile(key, new Blob([JSON.stringify(items)], { type: "application/json" })),
    getDoc: async (sha) => parseDocMeta(await cache.getDoc(sha)),
    putDoc: (sha, meta) => cache.putDoc(sha, meta),
    getTile: async (key) => {
      const blob = await cache.getTile(key);
      if (!blob) return null;
      try {
        return await decode(blob);
      } catch {
        return null;
      }
    },
    putTile: (key, blob) => cache.putTile(key, blob),
  };
}

/** The IndexedDB-backed cache for ImageBitmaps, or null without IndexedDB. */
export async function openRasterCache(): Promise<RasterCache<ImageBitmap> | null> {
  const cache = await openTileCache();
  return cache ? rasterCache(cache, (blob) => createImageBitmap(blob)) : null;
}
