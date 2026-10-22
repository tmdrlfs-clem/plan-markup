// Page-level pixel diff for the export spike (AC 4): the flattened export must
// render like the native export drawn with its appearance streams.
import pixelmatch from "pixelmatch";

import { countInk } from "../spike-btx/image.mjs";

/** Render scale for the diff, in px per pt (A3 at 1.5 → 1786 × 1263 px). */
export const DIFF_SCALE = 1.5;
/** pixelmatch colour threshold (0..1); anti-aliased pixels are ignored. */
export const DIFF_PIXEL_THRESHOLD = 0.1;
/**
 * Pass when the differing pixels are at most this share of the native
 * render's non-white pixels. Both files draw the same forms, so the expected
 * difference is zero; the allowance only absorbs rasteriser rounding.
 */
export const FLATTEN_MAX_DIFF_PERCENT = 0.5;

/** Compares two same-size RGBA renders. Returns { diffPixels, diffPercent, pass, diffImage }. */
export function diffPages(candidate, reference) {
  if (candidate.width !== reference.width || candidate.height !== reference.height) {
    return { diffPixels: null, diffPercent: null, pass: false, reason: `size differs (${candidate.width}x${candidate.height} vs ${reference.width}x${reference.height})` };
  }
  const out = new Uint8ClampedArray(reference.data.length);
  const diffPixels = pixelmatch(candidate.data, reference.data, out, reference.width, reference.height, {
    threshold: DIFF_PIXEL_THRESHOLD,
    includeAA: false,
  });
  const ink = countInk(reference);
  const diffPercent = ink === 0 ? 100 : (diffPixels / ink) * 100;
  return {
    diffPixels,
    diffPercent,
    pass: diffPercent <= FLATTEN_MAX_DIFF_PERCENT,
    diffImage: { width: reference.width, height: reference.height, data: out },
  };
}
