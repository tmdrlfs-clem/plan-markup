// Story 9.10: the one engine.worker the 4541 panel talks to. Place heads
// (Story 9.8) and the live check share it, and share one request counter, so
// each reply is read only by the request that asked for it.

import type { EngineReply, EngineRequest } from "@/core/sprinkler/engine/protocol";

/** The engine as the panel sees it: a worker in the app, a fake in tests. */
export type EngineChannel = {
  post(msg: EngineRequest): void;
  listen(fn: (reply: EngineReply) => void): () => void;
};

let channel: EngineChannel | null = null;
let channelFactory: () => EngineChannel = workerChannel;
let nextReq = 1;

/** Tests: a fake engine (null: back to the real worker). */
export function setEngineChannelFactory(factory: (() => EngineChannel) | null): void {
  channel = null;
  channelFactory = factory ?? workerChannel;
}

function workerChannel(): EngineChannel {
  const worker = new Worker(new URL("../../workers/engine.worker.ts", import.meta.url), { type: "module" });
  return {
    post: (msg) => worker.postMessage(msg),
    listen: (fn) => {
      const on = (e: MessageEvent) => fn(e.data as EngineReply);
      worker.addEventListener("message", on);
      return () => worker.removeEventListener("message", on);
    },
  };
}

export function engine(): EngineChannel {
  channel ??= channelFactory();
  return channel;
}

/** A request id no other request uses. */
export function nextRequestId(): number {
  return nextReq++;
}
