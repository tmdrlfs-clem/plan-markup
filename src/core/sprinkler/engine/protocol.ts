// Story 9.5 (design §7): engine.worker messages. Requests are validated with
// Zod at the worker boundary; replies never carry stack traces.
//
//   place  → progress* , zoneResult (one per zone, in order) , done
//   check  → checkResult , done
//   cancel → the running place request stops between zones and replies done { cancelled: true }
//
// The main thread drops results whose docRev is stale.

import { z } from "zod";

import type { OracleReport } from "../oracle";
import type { PlaceResult } from "../placer";
import { HAZARDS, ruleSetSchema } from "../rules/rules";

const coord = z.number().finite().min(-1e9).max(1e9);
const pt = z.strictObject({ x: coord, y: coord });
const ring = z.array(pt).max(20_000);
const mm = z.number().finite().positive().max(1e6);

const barrier = z.strictObject({ kind: z.enum(["wall", "column", "shaft"]), ring });
const keepOut = z.union([
  z.strictObject({ ring, clearance: mm.optional() }),
  z.strictObject({ circle: z.strictObject({ x: coord, y: coord, r: mm }), clearance: mm.optional() }),
]);
const grid = z.strictObject({
  angleDeg: z.number().finite().min(-360).max(360).optional(),
  pitchX: mm,
  pitchY: mm,
  originX: coord.optional(),
  originY: coord.optional(),
  mode: z.enum(["off", "preferred", "required"]),
});

export const engineZoneSchema = z.strictObject({
  zoneId: z.string().min(1).max(100),
  hazard: z.enum(HAZARDS),
  barriers: z.array(barrier).min(1).max(2_000),
  openEdges: z.array(z.strictObject({ a: pt, b: pt })).max(2_000).optional(),
  keepOuts: z.array(keepOut).max(2_000).optional(),
  pattern: z.enum(["rectangular", "staggered"]).optional(),
  prefs: z.strictObject({ spacing: mm.optional(), wallDist: mm.optional() }).optional(),
  grid: grid.nullable().optional(),
  locked: z.array(z.strictObject({ id: z.string().min(1).max(200), x: coord, y: coord })).max(5_000).optional(),
  frameDeg: z.number().finite().min(-360).max(360).optional(),
});

const reqId = z.number().int().nonnegative();
const docRev = z.number().int().nonnegative();
const head = z.strictObject({ id: z.string().min(1).max(200), x: coord, y: coord });

export const engineRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("place"), reqId, docRev, ruleSet: ruleSetSchema, zones: z.array(engineZoneSchema).min(1).max(50), idPrefix: z.string().max(40).optional() }),
  z.strictObject({
    type: z.literal("check"),
    reqId,
    docRev,
    ruleSet: ruleSetSchema,
    zone: engineZoneSchema,
    heads: z.array(head).max(5_000),
    neighbours: z.array(z.strictObject({ zone: engineZoneSchema, heads: z.array(head).max(5_000) })).max(50).optional(),
  }),
  z.strictObject({ type: z.literal("cancel"), reqId }),
]);

export type EngineRequest = z.infer<typeof engineRequestSchema>;

export type EngineReply =
  | { type: "progress"; reqId: number; done: number; total: number }
  | { type: "zoneResult"; reqId: number; docRev: number; zoneId: string; result: PlaceResult; report: OracleReport | null }
  | { type: "checkResult"; reqId: number; docRev: number; report: OracleReport }
  | { type: "done"; reqId: number; cancelled: boolean }
  | { type: "error"; reqId: number | null; code: "BAD_INPUT" | "INTERNAL"; message: string };
