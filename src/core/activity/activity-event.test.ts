import { describe, expect, it } from "vitest";

import { activityEventSchema } from "./activity-event";

const ID = "00000000-0000-7000-8000-000000000001";

describe("activity events (Story 8.4)", () => {
  it("takes counts and kinds only, the kind matching the event", () => {
    expect(activityEventSchema.safeParse({ name: "markup.exported", drawingId: ID, pageCount: 2, markupCount: 5, kind: "flattened" }).success).toBe(true);
    expect(activityEventSchema.safeParse({ name: "drawing.printed", drawingId: null, pageCount: 1, markupCount: 0, kind: "without_markups" }).success).toBe(true);
    expect(activityEventSchema.safeParse({ name: "drawing.printed", drawingId: null, pageCount: 1, markupCount: 0, kind: "editable" }).success).toBe(false);
    expect(activityEventSchema.safeParse({ name: "drawing.opened", drawingId: null, pageCount: 1, markupCount: 0, kind: "editable" }).success).toBe(false);
    expect(activityEventSchema.safeParse({ name: "markup.exported", drawingId: null, pageCount: 0, markupCount: 0, kind: "editable" }).success).toBe(false);
    // No room for a file name or content.
    expect(activityEventSchema.safeParse({ name: "markup.exported", drawingId: null, pageCount: 1, markupCount: 0, kind: "editable", filename: "A1721.pdf" }).success).toBe(false);
    expect(activityEventSchema.safeParse({ name: "markup.exported", drawingId: "A1721.pdf", pageCount: 1, markupCount: 0, kind: "editable" }).success).toBe(false);
  });
});
