// The render worker's raster cache: src/lib/idb/tile-cache.ts plus PNG <->
// ImageBitmap (Story 3.1). Stored document metadata is validated on the way
// out, so a corrupt or old entry is a miss, never a crash.

import { z } from "zod";
import { openTileCache, type TileCache } from "@/lib/idb/tile-cache";
import type { DocMeta, RasterCache } from "./render.worker";

const flags = z.object({ hasVector: z.boolean(), hasText: z.boolean(), imageOnly: z.boolean() });
const docMetaSchema = z.object({
  pages: z
    .array(z.object({ width: z.number().positive(), height: z.number().positive(), rotate: z.number().int() }))
    .min(1)
    .max(100_000),
  content: z.array(flags.nullable()),
  pageLabels: z.array(z.string().max(1000)).nullable().optional(),
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

/** Wraps a TileCache for bitmaps; `decode` turns a stored blob into a bitmap. */
export function rasterCache<B>(cache: TileCache, decode: (blob: Blob) => Promise<B>): RasterCache<B> {
  return {
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
