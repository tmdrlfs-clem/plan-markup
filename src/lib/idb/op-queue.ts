// Story 6.3 (NFR37, AR10): the local queue of changes waiting for the server.
//
// Every change is stored here before it is sent and leaves only once the
// server confirmed it, so a reload, a closed tab or a lost network never loses
// work. Per user (a shared computer never sends one user's changes as
// another's). Besides the queue: what each document's markup set is made from
// (its hash, name and pages, so a change made offline before the set exists
// can still make it later) and the markups' last known server versions.
//
// The storage is behind `OpQueueBackend`: IndexedDB in the browser, memory in
// tests and where IndexedDB is unavailable (then the queue lasts the page).

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { Calibration } from "@/core/calibration/calibration";
import type { MarkupOp } from "@/core/markup-set/markup-ops";
import type { EnsureMarkupSetInput } from "@/core/markup-set/markup-set";

/** A markup op as queued: its page by the client key (`<sha256>:<index>`); the server page id and base version are set when sent. */
export type QueuedMarkupOp = Omit<MarkupOp, "pageId" | "baseVersion"> & { pageKey?: string };

export type QueueEntry =
  | { seq?: number; userId: string; documentId: string; kind: "markup"; op: QueuedMarkupOp }
  | { seq?: number; userId: string; documentId: string; kind: "calibrations"; entries: { key: string; calibration: Calibration | null }[] };

export interface OpQueueBackend {
  /** Appends entries in order (their `seq` is set). */
  add(entries: QueueEntry[]): Promise<void>;
  /** The user's oldest entries, in order. */
  head(userId: string, limit: number): Promise<QueueEntry[]>;
  remove(seqs: readonly number[]): Promise<void>;
  count(userId: string): Promise<number>;
  putDoc(userId: string, documentId: string, input: EnsureMarkupSetInput): Promise<void>;
  getDoc(userId: string, documentId: string): Promise<EnsureMarkupSetInput | null>;
  putVersions(userId: string, versions: ReadonlyMap<string, number>): Promise<void>;
  getVersions(userId: string, markupIds: readonly string[]): Promise<Map<string, number>>;
  /** True when it survives a reload. */
  readonly durable: boolean;
}

export function memoryOpQueue(): OpQueueBackend {
  let next = 1;
  const queue: QueueEntry[] = [];
  const docs = new Map<string, EnsureMarkupSetInput>();
  const versions = new Map<string, number>();
  return {
    durable: false,
    async add(entries) {
      for (const e of entries) queue.push({ ...e, seq: next++ });
    },
    async head(userId, limit) {
      return queue.filter((e) => e.userId === userId).slice(0, limit);
    },
    async remove(seqs) {
      const gone = new Set(seqs);
      for (let i = queue.length - 1; i >= 0; i--) if (gone.has(queue[i].seq!)) queue.splice(i, 1);
    },
    async count(userId) {
      return queue.filter((e) => e.userId === userId).length;
    },
    async putDoc(userId, documentId, input) {
      docs.set(`${userId}:${documentId}`, input);
    },
    async getDoc(userId, documentId) {
      return docs.get(`${userId}:${documentId}`) ?? null;
    },
    async putVersions(userId, map) {
      for (const [id, v] of map) versions.set(`${userId}:${id}`, v);
    },
    async getVersions(userId, ids) {
      const out = new Map<string, number>();
      for (const id of ids) {
        const v = versions.get(`${userId}:${id}`);
        if (v !== undefined) out.set(id, v);
      }
      return out;
    },
  };
}

interface SyncDb extends DBSchema {
  queue: { key: number; value: QueueEntry; indexes: { byUser: [string, number] } };
  docs: { key: string; value: EnsureMarkupSetInput };
  versions: { key: string; value: number };
}

const DB_NAME = "pm-sync";

function idbOpQueue(db: IDBPDatabase<SyncDb>): OpQueueBackend {
  return {
    durable: true,
    async add(entries) {
      const tx = db.transaction("queue", "readwrite");
      for (const e of entries) {
        // No `seq` property at all: the key generator sets it (and the byUser index reads it).
        const value = { ...e };
        delete value.seq;
        e.seq = await tx.store.add(value);
      }
      await tx.done;
    },
    async head(userId, limit) {
      const out: QueueEntry[] = [];
      let cursor = await db.transaction("queue").store.index("byUser").openCursor(IDBKeyRange.bound([userId, 0], [userId, Number.MAX_SAFE_INTEGER]));
      while (cursor && out.length < limit) {
        out.push({ ...cursor.value, seq: cursor.primaryKey });
        cursor = await cursor.continue();
      }
      return out;
    },
    async remove(seqs) {
      const tx = db.transaction("queue", "readwrite");
      await Promise.all([...seqs.map((s) => tx.store.delete(s)), tx.done]);
    },
    async count(userId) {
      return db.countFromIndex("queue", "byUser", IDBKeyRange.bound([userId, 0], [userId, Number.MAX_SAFE_INTEGER]));
    },
    async putDoc(userId, documentId, input) {
      await db.put("docs", input, `${userId}:${documentId}`);
    },
    async getDoc(userId, documentId) {
      return (await db.get("docs", `${userId}:${documentId}`)) ?? null;
    },
    async putVersions(userId, map) {
      const tx = db.transaction("versions", "readwrite");
      await Promise.all([...[...map].map(([id, v]) => tx.store.put(v, `${userId}:${id}`)), tx.done]);
    },
    async getVersions(userId, ids) {
      const tx = db.transaction("versions");
      const values = await Promise.all(ids.map((id) => tx.store.get(`${userId}:${id}`)));
      await tx.done;
      const out = new Map<string, number>();
      ids.forEach((id, i) => {
        if (values[i] !== undefined) out.set(id, values[i]!);
      });
      return out;
    },
  };
}

/** The queue in IndexedDB, or in memory when IndexedDB cannot be opened. */
export async function openOpQueue(): Promise<OpQueueBackend> {
  if (typeof indexedDB === "undefined") return memoryOpQueue();
  try {
    const db = await openDB<SyncDb>(DB_NAME, 1, {
      upgrade(upgradeDb) {
        // The index key is [userId, seq]: seq is the primary key, copied into the value on add.
        const queue = upgradeDb.createObjectStore("queue", { keyPath: "seq", autoIncrement: true });
        queue.createIndex("byUser", ["userId", "seq"]);
        upgradeDb.createObjectStore("docs");
        upgradeDb.createObjectStore("versions");
      },
    });
    return idbOpQueue(db);
  } catch {
    return memoryOpQueue();
  }
}
