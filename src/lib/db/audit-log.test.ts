import { describe, expect, it } from "vitest";

import { detailUserIds, listAuditLog, parseAuditQuery } from "./audit-log";

const A = "00000000-0000-4000-8000-00000000000a";
const U = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const GONE = "00000000-0000-4000-8000-00000000000d";

type Call = { table: string; calls: [string, unknown[]][] };

/** A stand-in for the query builder: records each table's calls and resolves to the given result. */
function fakeClient(results: Record<string, unknown[]>) {
  const log: Call[] = [];
  const client = {
    from(table: string) {
      const entry: Call = { table, calls: [] };
      log.push(entry);
      const queue = results[table];
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === "then") {
              const result = queue?.shift() ?? { data: [], error: null, count: 0 };
              return (resolve: (v: unknown) => void) => resolve(result);
            }
            return (...args: unknown[]) => {
              entry.calls.push([prop, args]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  return { client: client as never, log };
}

const row = (over: Record<string, unknown>) => ({
  id: "e1",
  occurred_at: "2026-11-19T01:00:00Z",
  actor_id: A,
  action: "user.activated",
  target_type: "user",
  target_id: U,
  detail: { from: "pending", to: "active" },
  ...over,
});

describe("parseAuditQuery", () => {
  it("falls back to the defaults for anything unknown", () => {
    expect(parseAuditQuery({})).toEqual({ area: "all", search: "", page: 1 });
    expect(parseAuditQuery({ area: "drop", q: ["  pat ", "x"], page: "0" })).toEqual({ area: "all", search: "pat", page: 1 });
    expect(parseAuditQuery({ area: "company", q: "a".repeat(300), page: "3" })).toEqual({ area: "company", search: "a".repeat(100), page: 3 });
  });
});

describe("detailUserIds", () => {
  it("takes only uuids under the known keys", () => {
    expect(detailUserIds({ user_id: U, admin_user_id: "nope", other: A })).toEqual([U]);
  });
});

describe("listAuditLog", () => {
  it("reads a page newest first, filtered by area, and names everyone it mentions", async () => {
    const { client, log } = fakeClient({
      audit_log: [
        {
          data: [
            row({}),
            row({ id: "e2", action: "company.member_removed", target_type: "company", target_id: C, detail: { user_id: GONE, role: "member" } }),
          ],
          error: null,
          count: 2,
        },
      ],
      profiles: [{ data: [{ id: A, name: "Ada Admin", email: "ada@x.test" }, { id: U, name: "", email: "u@x.test" }], error: null }],
      companies: [{ data: [{ id: C, name: "Acme Fire" }], error: null }],
    });
    const list = await listAuditLog(client, { area: "company", search: "", page: 2 });

    const audit = log.find((c) => c.table === "audit_log")!;
    expect(audit.calls).toContainEqual(["like", ["action", "company.%"]]);
    expect(audit.calls).toContainEqual(["range", [50, 99]]);
    expect(audit.calls).toContainEqual(["order", ["occurred_at", { ascending: false }]]);

    expect(list.total).toBe(2);
    expect(list.entries[0].actor).toMatchObject({ label: "Ada Admin", email: "ada@x.test", known: true });
    expect(list.entries[0].target).toMatchObject({ label: "u@x.test", known: true });
    expect(list.entries[1].target).toMatchObject({ label: "Acme Fire" });
    expect(list.entries[1].people[GONE]).toMatchObject({ label: "Removed account", known: false });
  });

  it("searches people and companies, then filters entries by actor or target", async () => {
    const { client, log } = fakeClient({
      profiles: [{ data: [{ id: U }], error: null }, { data: [], error: null }],
      companies: [{ data: [{ id: C }], error: null }, { data: [], error: null }],
      audit_log: [{ data: [], error: null, count: 0 }],
    });
    await listAuditLog(client, { area: "all", search: 'a,b"(', page: 1 });

    const search = log.find((c) => c.table === "profiles")!;
    expect(search.calls[1]).toEqual(["or", ['email.ilike."%a,b\\"(%",name.ilike."%a,b\\"(%"']]);
    const audit = log.find((c) => c.table === "audit_log")!;
    expect(audit.calls).toContainEqual(["or", [`actor_id.in.(${U}),and(target_type.eq.user,target_id.in.(${U})),and(target_type.eq.company,target_id.in.(${C}))`]]);
    expect(audit.calls.some(([m]) => m === "like")).toBe(false);
  });

  it("returns nothing without reading the log when the search matches no one", async () => {
    const { client, log } = fakeClient({ profiles: [{ data: [], error: null }], companies: [{ data: [], error: null }] });
    const list = await listAuditLog(client, { area: "all", search: "zzz", page: 1 });
    expect(list).toEqual({ entries: [], total: 0, searchTruncated: false });
    expect(log.find((c) => c.table === "audit_log")?.calls.some(([m]) => m === "or")).toBe(false);
  });

  it("throws with the code only", async () => {
    const { client } = fakeClient({ audit_log: [{ data: null, error: { code: "42501", message: "secret" } }] });
    await expect(listAuditLog(client, { area: "all", search: "", page: 1 })).rejects.toThrow("Could not read the audit log: 42501");
  });
});
