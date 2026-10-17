// The drawing_id tag: the only data-bearing tag allowed on Sentry events.
import * as Sentry from "@sentry/nextjs";
import { logger } from "@/lib/logger";
import { isSafeDrawingId } from "./scrub";

/**
 * Sets the drawing_id tag for a UUID, or clears it for null. Any other value
 * clears it and logs a warning without the value. Story 3.x calls this when a
 * drawing opens or closes.
 */
export function setDrawingContext(drawingId: string | null): void {
  if (drawingId !== null && isSafeDrawingId(drawingId)) {
    Sentry.setTag("drawing_id", drawingId);
    return;
  }
  Sentry.setTag("drawing_id", undefined);
  if (drawingId !== null) logger.warn("sentry.invalid_drawing_id");
}
