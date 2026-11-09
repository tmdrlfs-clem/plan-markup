// Story 8.4 (FR80, AR21): the product activity events the client reports,
// named <domain>.<past_verb>, shared by the client and the server action.
// Counts and kinds only: never drawing content, titles or file names.

import { z } from "zod";

import { UUID_PATTERN } from "@/core/ids/uuid";

export const ACTIVITY_KINDS = {
  "markup.exported": ["editable", "flattened"],
  "drawing.printed": ["with_markups", "without_markups"],
  /** Story 9.8: a Place heads run (all zones of the page, or the selected ones); markupCount = heads. */
  "sprinkler.placed": ["all_zones", "selected_zones"],
} as const;

export type ActivityName = keyof typeof ACTIVITY_KINDS;

export const activityEventSchema = z
  .strictObject({
    name: z.enum(["markup.exported", "drawing.printed", "sprinkler.placed"]),
    /** The user's markup set (a drawings row), when they have one for the file. */
    drawingId: z.string().regex(UUID_PATTERN).nullable(),
    pageCount: z.number().int().min(1).max(100_000),
    markupCount: z.number().int().min(0).max(10_000_000),
    kind: z.enum(["editable", "flattened", "with_markups", "without_markups", "all_zones", "selected_zones"]),
  })
  .refine((e) => (ACTIVITY_KINDS[e.name] as readonly string[]).includes(e.kind), { path: ["kind"] });

export type ActivityEvent = z.infer<typeof activityEventSchema>;
