import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileStatus } from "./profiles";
import type { Database } from "./types.gen";

// Story 10.9 (FR14, FR16): activity per account, read with the caller's own
// client. public.activity_summary() decides who sees whom: the platform admin
// everyone, a company admin their own company, anyone else nothing. Counts and
// times only: no drawing content reaches this code.

export type ActivityScope = "platform" | "company";

/** How many weeks the summary covers: this week and the three before it. */
export const ACTIVITY_WEEKS = 4;

export const WEEK_LABELS: readonly string[] = ["This week", "Last week", "2 weeks ago", "3 weeks ago"];

export type ActivityRow = {
  userId: string;
  name: string;
  email: string;
  status: ProfileStatus;
  companyId: string | null;
  companyName: string | null;
  /** ISO time, or null when the account has never signed in, saved or exported. */
  lastActiveAt: string | null;
  markupsTotal: number;
  /** Markups saved per week, this week first. */
  markupsByWeek: number[];
  exportsTotal: number;
  /** PDFs exported per week, this week first. */
  exportsByWeek: number[];
};

const STATUSES: readonly ProfileStatus[] = ["pending", "active", "deactivated"];

function weeks(value: unknown): number[] {
  const list = Array.isArray(value) ? value : [];
  return Array.from({ length: ACTIVITY_WEEKS }, (_, i) => (typeof list[i] === "number" && Number.isFinite(list[i]) ? list[i] : 0));
}

export async function getActivitySummary(client: SupabaseClient<Database>, scope: ActivityScope): Promise<ActivityRow[]> {
  const { data, error } = await client.rpc("activity_summary", { p_scope: scope });
  if (error) throw new Error(`Could not read the activity: ${error.code ?? "unknown"}`);
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    name: row.name,
    email: row.email,
    status: STATUSES.includes(row.status as ProfileStatus) ? (row.status as ProfileStatus) : "pending",
    companyId: row.company_id,
    companyName: row.company_name,
    lastActiveAt: row.last_active_at,
    markupsTotal: row.markups_total,
    markupsByWeek: weeks(row.markups_by_week),
    exportsTotal: row.exports_total,
    exportsByWeek: weeks(row.exports_by_week),
  }));
}

export type ActivityGroup = {
  /** null for accounts that are in no company. */
  companyId: string | null;
  companyName: string | null;
  rows: ActivityRow[];
  lastActiveAt: string | null;
  markupsTotal: number;
  markupsByWeek: number[];
  exportsTotal: number;
  exportsByWeek: number[];
};

function sum(lists: number[][]): number[] {
  return Array.from({ length: ACTIVITY_WEEKS }, (_, i) => lists.reduce((total, list) => total + (list[i] ?? 0), 0));
}

/** Rows grouped by company (by name), with each company's totals; accounts in no company come last. */
export function groupByCompany(rows: readonly ActivityRow[]): ActivityGroup[] {
  const byCompany = new Map<string | null, ActivityRow[]>();
  for (const row of rows) {
    const list = byCompany.get(row.companyId);
    if (list) list.push(row);
    else byCompany.set(row.companyId, [row]);
  }
  return [...byCompany.entries()]
    .map(([companyId, list]) => ({
      companyId,
      companyName: list[0]?.companyName ?? null,
      rows: list,
      lastActiveAt: list.reduce<string | null>(
        (latest, row) => (row.lastActiveAt && (!latest || Date.parse(row.lastActiveAt) > Date.parse(latest)) ? row.lastActiveAt : latest),
        null,
      ),
      markupsTotal: list.reduce((total, row) => total + row.markupsTotal, 0),
      markupsByWeek: sum(list.map((row) => row.markupsByWeek)),
      exportsTotal: list.reduce((total, row) => total + row.exportsTotal, 0),
      exportsByWeek: sum(list.map((row) => row.exportsByWeek)),
    }))
    .sort((a, b) => {
      if (a.companyId === null) return 1;
      if (b.companyId === null) return -1;
      return (a.companyName ?? "").localeCompare(b.companyName ?? "");
    });
}
