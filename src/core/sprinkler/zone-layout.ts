// Story 9.8 (FR73, A7): a Place heads run as saved per zone (public.zone_layouts):
// the ruleset version used, the engine inputs (mm), the result and the oracle
// report. Shared by the client and the server action. Framework-free.

import { z } from "zod";

import { UUID_PATTERN } from "@/core/ids/uuid";

/** The largest JSON part saved (the database allows 1 MiB per column). */
export const MAX_LAYOUT_JSON = 900_000;

const json = z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v).length <= MAX_LAYOUT_JSON, { message: "too large" });

export const ZONE_LAYOUT_STATUSES = ["placed", "infeasible", "failed"] as const;

export const zoneLayoutSchema = z.strictObject({
  zoneId: z.string().regex(UUID_PATTERN),
  rulesetId: z.string().regex(/^[a-z0-9-]{1,40}$/),
  ruleVersion: z.string().regex(/^[0-9]{1,6}$/),
  status: z.enum(ZONE_LAYOUT_STATUSES),
  headCount: z.number().int().min(0).max(5_000),
  inputs: json,
  result: json,
  report: json.nullable(),
});
export type ZoneLayout = z.infer<typeof zoneLayoutSchema>;

export const saveZoneLayoutsSchema = z.strictObject({
  drawingId: z.string().regex(UUID_PATTERN),
  layouts: z.array(zoneLayoutSchema).min(1).max(50),
});
export type SaveZoneLayouts = z.infer<typeof saveZoneLayoutsSchema>;
