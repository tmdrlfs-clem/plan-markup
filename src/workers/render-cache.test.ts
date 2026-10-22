import { describe, expect, it } from "vitest";
import { TileCache, memoryTileBackend } from "@/lib/idb/tile-cache";
import { parseDocMeta, rasterCache } from "./render-cache";

const meta = { pages: [{ width: 10, height: 20, rotate: 0 }], content: [null] };

describe("parseDocMeta", () => {
  it("accepts valid metadata and rejects anything else", () => {
    expect(parseDocMeta(meta)).toEqual(meta);
    expect(parseDocMeta({ ...meta, content: [] })).toBeNull();
    expect(parseDocMeta({ pages: [], content: [] })).toBeNull();
    expect(parseDocMeta({ pages: [{ width: -1, height: 2, rotate: 0 }], content: [null] })).toBeNull();
    expect(parseDocMeta("x")).toBeNull();
    expect(parseDocMeta(null)).toBeNull();
  });
});

describe("rasterCache", () => {
  it("decodes stored tiles and treats a decode failure as a miss", async () => {
    const tiles = new TileCache(memoryTileBackend());
    const cache = rasterCache(tiles, async (blob) => {
      const text = await blob.text();
      if (text === "bad") throw new Error("decode");
      return text;
    });
    await cache.putTile("ok", new Blob(["pixels"]));
    await cache.putTile("broken", new Blob(["bad"]));
    expect(await cache.getTile("ok")).toBe("pixels");
    expect(await cache.getTile("broken")).toBeNull();
    expect(await cache.getTile("none")).toBeNull();
    await cache.putDoc("sha", meta);
    expect(await cache.getDoc("sha")).toEqual(meta);
    await tiles.putDoc("old", { pages: "nope" });
    expect(await cache.getDoc("old")).toBeNull();
  });
});
