import type { SupabaseClient } from "@supabase/supabase-js";

import { ilikePattern } from "./admin-users";
import type { Database, Json } from "./types.gen";

// The platform admin's audit log screen (NFR34). Read with the admin's own
// client: RLS (audit_log_select_platform_admin, profiles_select_platform_admin,
// companies_select_member_or_platform_admin) decides, not this code. Read only:
// the table is append-only and written by the audited functions.

export type AuditArea = "all" | "user" | "company" | "rules" | "support";

export const AUDIT_AREAS: readonly AuditArea[] = ["all", "user", "company", "rules", "support"];
export const AUDIT_PAGE_SIZE = 50;
/** People and companies a search may match; a broader search should be narrowed. */
export const AUDIT_SEARCH_MATCH_LIMIT = 200;

export type AuditQuery = { area: AuditArea; search: string; page: number };

/** Someone or something an entry names, resolved for display. */
export type AuditParty = { id: string; label: string; email: string | null; known: boolean };

export type AuditEntry = {
  id: string;
  occurredAt: string;
  action: string;
  actor: AuditParty;
  targetType: string;
  target: AuditParty;
  /** The detail object; other user ids in it resolved where known (by id). */
  detail: Record<string, Json | undefined>;
  people: Record<string, AuditParty>;
};

export type AuditList = {
  entries: AuditEntry[];
  /** Entries matching the area and search, on every page. */
  total: number;
  /** Whether the search matched more people or companies than were used. */
  searchTruncated: boolean;
};

/** Reads ?area=&q=&page= into a query, falling back to the defaults for anything it does not know. */
export function parseAuditQuery(params: Record<string, string | string[] | undefined>): AuditQuery {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const areaParam = one(params.area);
  const area = (AUDIT_AREAS as readonly string[]).includes(areaParam) ? (areaParam as AuditArea) : "all";
  const search = one(params.q).trim().slice(0, 100);
  const pageNumber = Number.parseInt(one(params.page), 10);
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 10_000 ? pageNumber : 1;
  return { area, search, page };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function quoted(pattern: string): string {
  // Quoted, so commas, dots and parentheses in the search are data, not or() grammar.
  return `"${pattern.replace(/[\\"]/g, (c) => "\\" + c)}"`;
}

/** User ids an entry's detail names (a member whose role changed or who was removed, a company's first admin). */
export function detailUserIds(detail: Record<string, unknown>): string[] {
  return ["user_id", "admin_user_id"]
    .map((key) => detail[key])
    .filter((value): value is string => typeof value === "string" && UUID.test(value));
}

function asObject(value: Json): Record<string, Json | undefined> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export async function listAuditLog(client: SupabaseClient<Database>, query: AuditQuery): Promise<AuditList> {
  const from = (query.page - 1) * AUDIT_PAGE_SIZE;
  let rowsQuery = client
    .from("audit_log")
    .select("id, occurred_at, actor_id, action, target_type, target_id, detail", { count: "exact" })
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, from + AUDIT_PAGE_SIZE - 1);
  if (query.area !== "all") rowsQuery = rowsQuery.like("action", `${query.area}.%`);

  let searchTruncated = false;
  if (query.search !== "") {
    const pattern = quoted(ilikePattern(query.search));
    const [people, companies] = await Promise.all([
      client.from("profiles").select("id").or(`email.ilike.${pattern},name.ilike.${pattern}`).limit(AUDIT_SEARCH_MATCH_LIMIT + 1),
      client.from("companies").select("id").ilike("name", ilikePattern(query.search)).limit(AUDIT_SEARCH_MATCH_LIMIT + 1),
    ]);
    if (people.error) throw new Error(`Could not search the accounts: ${people.error.code ?? "unknown"}`);
    if (companies.error) throw new Error(`Could not search the companies: ${companies.error.code ?? "unknown"}`);
    searchTruncated = people.data.length > AUDIT_SEARCH_MATCH_LIMIT || companies.data.length > AUDIT_SEARCH_MATCH_LIMIT;
    const userIds = people.data.slice(0, AUDIT_SEARCH_MATCH_LIMIT).map((p) => p.id);
    const companyIds = companies.data.slice(0, AUDIT_SEARCH_MATCH_LIMIT).map((c) => c.id);
    if (userIds.length === 0 && companyIds.length === 0) return { entries: [], total: 0, searchTruncated: false };
    const clauses: string[] = [];
    if (userIds.length) {
      const list = userIds.join(",");
      clauses.push(`actor_id.in.(${list})`, `and(target_type.eq.user,target_id.in.(${list}))`);
    }
    if (companyIds.length) clauses.push(`and(target_type.eq.company,target_id.in.(${companyIds.join(",")}))`);
    rowsQuery = rowsQuery.or(clauses.join(","));
  }

  const rows = await rowsQuery;
  if (rows.error) throw new Error(`Could not read the audit log: ${rows.error.code ?? "unknown"}`);
  const data = rows.data ?? [];

  // Resolve every person and company the page names, in two reads.
  const userIds = new Set<string>();
  const companyIds = new Set<string>();
  for (const row of data) {
    userIds.add(row.actor_id);
    if (row.target_type === "user") userIds.add(row.target_id);
    if (row.target_type === "company") companyIds.add(row.target_id);
    for (const id of detailUserIds(asObject(row.detail))) userIds.add(id);
  }
  const [profiles, companies] = await Promise.all([
    userIds.size
      ? client.from("profiles").select("id, name, email").in("id", [...userIds])
      : Promise.resolve({ data: [] as { id: string; name: string; email: string }[], error: null }),
    companyIds.size
      ? client.from("companies").select("id, name").in("id", [...companyIds])
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);
  if (profiles.error) throw new Error(`Could not read the accounts: ${profiles.error.code ?? "unknown"}`);
  if (companies.error) throw new Error(`Could not read the companies: ${companies.error.code ?? "unknown"}`);
  const personOf = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  const companyOf = new Map((companies.data ?? []).map((c) => [c.id, c]));

  const person = (id: string): AuditParty => {
    const p = personOf.get(id);
    if (!p) return { id, label: "Removed account", email: null, known: false };
    const name = p.name.trim();
    return { id, label: name === "" ? p.email : name, email: p.email, known: true };
  };
  const target = (type: string, id: string, detail: Record<string, Json | undefined>): AuditParty => {
    if (type === "user") return person(id);
    if (type === "company") {
      const c = companyOf.get(id);
      if (c) return { id, label: c.name, email: null, known: true };
      const named = typeof detail.name === "string" && detail.name !== "" ? detail.name : null;
      return { id, label: named ?? "Removed company", email: null, known: false };
    }
    if (type === "use_hazard_map" && id === NIL_UUID) return { id, label: "Platform default use → hazard map", email: null, known: true };
    if (type === "rule_figures") {
      const version = typeof detail.version === "number" ? ` v${detail.version}` : "";
      const ruleset = typeof detail.ruleset === "string" ? detail.ruleset : "Rule figures";
      return { id, label: `${ruleset}${version}`, email: null, known: true };
    }
    return { id, label: type, email: null, known: false };
  };

  return {
    entries: data.map((row) => {
      const detail = asObject(row.detail);
      return {
        id: row.id,
        occurredAt: row.occurred_at,
        action: row.action,
        actor: person(row.actor_id),
        targetType: row.target_type,
        target: target(row.target_type, row.target_id, detail),
        detail,
        people: Object.fromEntries(detailUserIds(detail).map((id) => [id, person(id)])),
      };
    }),
    total: rows.count ?? 0,
    searchTruncated,
  };
}
