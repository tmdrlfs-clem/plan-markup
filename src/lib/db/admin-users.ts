import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileStatus } from "./profiles";
import type { Database } from "./types.gen";

// Story 10.4: the platform admin's account list. Read with the admin's own
// client: RLS (profiles_select_platform_admin) decides, not this code.

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  status: ProfileStatus;
  isPlatformAdmin: boolean;
  createdAt: string;
};

export type AdminUserFilter = "all" | ProfileStatus;

export const ADMIN_USER_FILTERS: readonly AdminUserFilter[] = ["pending", "active", "deactivated", "all"];
export const ADMIN_USERS_PAGE_SIZE = 50;

export type AdminUserQuery = { filter: AdminUserFilter; search: string; page: number };

export type AdminUserList = {
  rows: AdminUserRow[];
  /** Accounts matching the filter and search, on every page. */
  total: number;
  /** Accounts per status, ignoring the search (the filter tabs). */
  counts: Record<ProfileStatus, number>;
};

/**
 * Reads ?status=&q=&page= into a query, falling back to the defaults for
 * anything it does not know. The search is trimmed and capped; it is only ever
 * used as a bound ilike pattern.
 */
export function parseAdminUserQuery(params: Record<string, string | string[] | undefined>): AdminUserQuery {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const status = one(params.status);
  const filter = (ADMIN_USER_FILTERS as readonly string[]).includes(status) ? (status as AdminUserFilter) : "pending";
  const search = one(params.q).trim().slice(0, 100);
  const pageNumber = Number.parseInt(one(params.page), 10);
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 10_000 ? pageNumber : 1;
  return { filter, search, page };
}

/** Escapes %, _ and \ so the search matches them literally. */
export function ilikePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const STATUSES: readonly ProfileStatus[] = ["pending", "active", "deactivated"];

export async function listAdminUsers(client: SupabaseClient<Database>, query: AdminUserQuery): Promise<AdminUserList> {
  const from = (query.page - 1) * ADMIN_USERS_PAGE_SIZE;
  let rowsQuery = client
    .from("profiles")
    .select("id, name, email, status, is_platform_admin, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, from + ADMIN_USERS_PAGE_SIZE - 1);
  if (query.filter !== "all") rowsQuery = rowsQuery.eq("status", query.filter);
  if (query.search !== "") {
    const pattern = ilikePattern(query.search);
    // Quoted, so commas, dots and parentheses in the search are data, not or() grammar.
    const quoted = `"${pattern.replace(/[\\"]/g, (c) => "\\" + c)}"`;
    rowsQuery = rowsQuery.or(`email.ilike.${quoted},name.ilike.${quoted}`);
  }

  const [rows, ...counts] = await Promise.all([
    rowsQuery,
    ...STATUSES.map((status) => client.from("profiles").select("id", { count: "exact", head: true }).eq("status", status)),
  ]);
  if (rows.error) throw new Error(`Could not list the accounts: ${rows.error.code ?? "unknown"}`);
  for (const count of counts) {
    if (count.error) throw new Error(`Could not count the accounts: ${count.error.code ?? "unknown"}`);
  }

  return {
    rows: (rows.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      status: STATUSES.includes(row.status as ProfileStatus) ? (row.status as ProfileStatus) : "pending",
      isPlatformAdmin: row.is_platform_admin,
      createdAt: row.created_at,
    })),
    total: rows.count ?? 0,
    counts: {
      pending: counts[0]?.count ?? 0,
      active: counts[1]?.count ?? 0,
      deactivated: counts[2]?.count ?? 0,
    },
  };
}
