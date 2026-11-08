// Story 9.5 (AR14, design §7): the 4541 engine worker. Placement and the
// oracle check run here, off the main thread.
//
// Requests (validated with Zod, src/core/sprinkler/engine/protocol.ts):
//   { type: "place", reqId, docRev, ruleSet, zones, idPrefix? }
//     → progress after each zone is placed, then one zoneResult per zone (placement
//       and oracle report, in order), then done.
//   { type: "check", reqId, docRev, ruleSet, zone, heads, neighbours? } → checkResult, done.
//   { type: "cancel", reqId } → the running place request stops at the next zone
//       boundary and replies done { cancelled: true }.
// A bad request gets { type: "error", code: "BAD_INPUT" }; an unexpected failure
// gets code "INTERNAL". Replies carry no stack traces.

import { checkPlacement, others, placeInSequence, type EngineZone } from "@/core/sprinkler/engine/site";
import { engineRequestSchema, type EngineReply, type EngineRequest } from "@/core/sprinkler/engine/protocol";
import type { PlaceResult } from "@/core/sprinkler/placer";

type PlaceRequest = Extract<EngineRequest, { type: "place" }>;
type CheckRequest = Extract<EngineRequest, { type: "check" }>;

const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Handles engine messages; exported so tests can drive it without a real Worker. */
export class EngineHost {
  private readonly active = new Set<number>();
  private readonly cancelled = new Set<number>();

  constructor(
    private readonly post: (reply: EngineReply) => void,
    /** Lets queued messages (a cancel) in between zones. */
    private readonly yieldTurn: () => Promise<void> = nextTurn,
  ) {}

  async handle(data: unknown): Promise<void> {
    const parsed = engineRequestSchema.safeParse(data);
    if (!parsed.success) {
      const raw = typeof data === "object" && data !== null ? (data as { reqId?: unknown }).reqId : undefined;
      const reqId = typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : null;
      const issue = parsed.error.issues[0];
      this.post({ type: "error", reqId, code: "BAD_INPUT", message: `Invalid engine request${issue ? ` at ${issue.path.join(".") || "(root)"}: ${issue.message}` : ""}`.slice(0, 300) });
      return;
    }
    const msg = parsed.data;
    if (msg.type === "cancel") {
      if (this.active.has(msg.reqId)) this.cancelled.add(msg.reqId);
      return;
    }
    this.active.add(msg.reqId);
    try {
      if (msg.type === "place") await this.place(msg);
      else this.check(msg);
    } catch (e) {
      this.post({ type: "error", reqId: msg.reqId, code: "INTERNAL", message: e instanceof Error ? e.message.slice(0, 300) : "Engine failure" });
    } finally {
      this.active.delete(msg.reqId);
      this.cancelled.delete(msg.reqId);
    }
  }

  private async place(msg: PlaceRequest): Promise<void> {
    const zones = msg.zones as EngineZone[];
    const results: PlaceResult[] = [];
    const stop = () => {
      this.post({ type: "done", reqId: msg.reqId, cancelled: true });
    };
    for (let i = 0; i < zones.length; i++) {
      await this.yieldTurn();
      if (this.cancelled.has(msg.reqId)) return stop();
      results.push(placeInSequence(zones[i], results, msg.ruleSet, msg.idPrefix));
      this.post({ type: "progress", reqId: msg.reqId, done: i + 1, total: zones.length });
    }
    for (let i = 0; i < zones.length; i++) {
      await this.yieldTurn();
      if (this.cancelled.has(msg.reqId)) return stop();
      const r = results[i];
      const report = r.heads.length || r.ok ? checkPlacement(zones[i], r.heads, others(zones, results, i), msg.ruleSet) : null;
      this.post({ type: "zoneResult", reqId: msg.reqId, docRev: msg.docRev, zoneId: zones[i].zoneId, result: r, report });
    }
    this.post({ type: "done", reqId: msg.reqId, cancelled: false });
  }

  private check(msg: CheckRequest): void {
    const report = checkPlacement(msg.zone as EngineZone, msg.heads, (msg.neighbours ?? []) as { zone: EngineZone; heads: { id: string; x: number; y: number }[] }[], msg.ruleSet);
    this.post({ type: "checkResult", reqId: msg.reqId, docRev: msg.docRev, report });
    this.post({ type: "done", reqId: msg.reqId, cancelled: false });
  }
}

type WorkerScope = {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
};

declare const WorkerGlobalScope: (new () => unknown) | undefined;

// Wire up only inside a real worker (not in Vitest/Node).
if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  const scope = globalThis as unknown as WorkerScope;
  const host = new EngineHost((reply) => scope.postMessage(reply));
  scope.addEventListener("message", (event) => {
    void host.handle(event.data);
  });
}
