import { describe, expect, it } from "vitest";

import type { EngineReply } from "@/core/sprinkler/engine/protocol";
import { NZS4541_V1 } from "@/core/sprinkler/rules/rules";

import { EngineHost } from "./engine.worker";

const rect = (w: number, h: number, x0 = 0) => [
  { x: x0, y: 0 },
  { x: x0 + w, y: 0 },
  { x: x0 + w, y: h },
  { x: x0, y: h },
];
const zone = (zoneId: string, x0 = 0) => ({ zoneId, hazard: "OH1" as const, barriers: [{ kind: "wall" as const, ring: rect(10_000, 6_000, x0) }] });

function host(yieldTurn?: () => Promise<void>) {
  const replies: EngineReply[] = [];
  return { replies, h: new EngineHost((r) => replies.push(structuredClone(r)), yieldTurn ?? (() => Promise.resolve())) };
}

describe("engine worker", () => {
  it("streams each zone's heads as it is placed, then the oracle reports, then done", async () => {
    const { h, replies } = host();
    await h.handle({ type: "place", reqId: 1, docRev: 7, ruleSet: NZS4541_V1, zones: [zone("A"), zone("B", 20_000)] });
    expect(replies.map((r) => r.type)).toEqual(["progress", "zoneResult", "progress", "zoneResult", "zoneReport", "zoneReport", "done"]);
    const results = replies.filter((r) => r.type === "zoneResult");
    for (const r of results) {
      expect(r.docRev).toBe(7);
      expect(r.result.ok).toBe(true);
      expect(r.result.heads).toHaveLength(6);
    }
    expect(results.map((r) => r.zoneId)).toEqual(["A", "B"]);
    const reports = replies.filter((r) => r.type === "zoneReport");
    expect(reports.map((r) => [r.zoneId, r.docRev, r.report?.errors])).toEqual([
      ["A", 7, 0],
      ["B", 7, 0],
    ]);
    expect(replies.at(-1)).toEqual({ type: "done", reqId: 1, cancelled: false });
  });

  it("reports a typed placement error in the zone result", async () => {
    const { h, replies } = host();
    const thin = { zoneId: "N", hazard: "ELH" as const, barriers: [{ kind: "wall" as const, ring: rect(6_000, 90) }] };
    await h.handle({ type: "place", reqId: 2, docRev: 1, ruleSet: NZS4541_V1, zones: [thin] });
    const r = replies.find((x) => x.type === "zoneResult");
    expect(r?.type === "zoneResult" && !r.result.ok && r.result.error.code).toBe("NO_ADMISSIBLE_REGION");
    const rep = replies.find((x) => x.type === "zoneReport");
    expect(rep?.type === "zoneReport" && rep.report).toBeNull();
  });

  it("checks given heads with the oracle", async () => {
    const { h, replies } = host();
    await h.handle({ type: "check", reqId: 3, docRev: 2, ruleSet: NZS4541_V1, zone: zone("A"), heads: [{ id: "h1", x: 5_000, y: 3_000 }] });
    const r = replies[0];
    expect(r.type).toBe("checkResult");
    expect(r.type === "checkResult" && r.report.flags.some((f) => f.code === "UNCOVERED")).toBe(true);
    expect(replies[1]).toEqual({ type: "done", reqId: 3, cancelled: false });
  });

  it("stops a running place request at the next zone boundary on cancel", async () => {
    let release: () => void = () => undefined;
    const gate = () => new Promise<void>((resolve) => (release = resolve));
    const { h, replies } = host(gate);
    const running = h.handle({ type: "place", reqId: 4, docRev: 1, ruleSet: NZS4541_V1, zones: [zone("A"), zone("B", 20_000), zone("C", 40_000)] });
    release(); // zone A
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    await h.handle({ type: "cancel", reqId: 4 });
    release();
    await running;
    expect(replies.filter((r) => r.type === "zoneResult").length).toBeLessThan(3);
    expect(replies.filter((r) => r.type === "zoneReport")).toEqual([]);
    expect(replies.at(-1)).toEqual({ type: "done", reqId: 4, cancelled: true });
    expect(replies.filter((r) => r.type === "progress").length).toBeLessThan(3);
  });

  it("rejects bad input with BAD_INPUT and no stack", async () => {
    const { h, replies } = host();
    await h.handle({ type: "place", reqId: 5, docRev: 1, ruleSet: NZS4541_V1, zones: [{ ...zone("A"), hazard: "XX" }] });
    await h.handle({ type: "place", reqId: 6, docRev: 1, ruleSet: { ...NZS4541_V1, units: "ft" }, zones: [zone("A")] });
    await h.handle(null);
    await h.handle({ type: "nope", reqId: 8 });
    expect(replies.map((r) => (r.type === "error" ? [r.reqId, r.code] : r.type))).toEqual([
      [5, "BAD_INPUT"],
      [6, "BAD_INPUT"],
      [null, "BAD_INPUT"],
      [8, "BAD_INPUT"],
    ]);
    for (const r of replies) expect(JSON.stringify(r)).not.toMatch(/\bat .*\.ts/);
  });

  it("ignores a cancel for a request that is not running", async () => {
    const { h, replies } = host();
    await h.handle({ type: "cancel", reqId: 99 });
    expect(replies).toEqual([]);
  });
});
