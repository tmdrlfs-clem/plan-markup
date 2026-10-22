import { describe, expect, it } from "vitest";

import { MAX_BUCKET, MIN_BUCKET, bucketScale } from "@/core/render/tiles";

import { tilePayloadSchema } from "./render-protocol";

describe("tilePayloadSchema", () => {
  it("accepts every zoom bucket the viewer can request, at its scale", () => {
    for (const bucket of [MIN_BUCKET, 0, MAX_BUCKET]) {
      const payload = { page: 1, bucket, scale: bucketScale(bucket), col: 0, row: 0, tileSize: 512 };
      expect(tilePayloadSchema.safeParse(payload).success).toBe(true);
    }
  });

  it("rejects buckets outside the range", () => {
    for (const bucket of [MIN_BUCKET - 1, MAX_BUCKET + 1]) {
      expect(tilePayloadSchema.safeParse({ page: 1, bucket, scale: 1, col: 0, row: 0, tileSize: 512 }).success).toBe(false);
    }
  });
});
