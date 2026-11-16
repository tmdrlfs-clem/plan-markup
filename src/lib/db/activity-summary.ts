import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileStatus } from "./profiles";
import type { Database } from "./types.gen";

// Story 10.9 (FR14, FR16): activity per account, read with the caller's own
// client. public.activity_summary() decides who sees whom: the platform admin
// everyone, a company admin their own company, anyone else nothing. Counts and
// times only: no drawing content reaches this code.

export type ActivityScope = "platform" | "company";

/** "week": one week by kind of work. "weeks": markups and PDFs across four weeks. */
export type ActivityView = "week" | "weeks";

/** Reads ?view=, falling back to the one-week view. */
export function parseActivityView(value: string | string[] | undefined): ActivityView {
  return (Array.isArray(value) ? value[0] : value) === "weeks" ? "weeks" : "week";
}

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
  /** Days with a saved markup or a recorded action per week (0 to 7), this week first. */
  activeDaysByWeek: number[];
  /** Different markup sets the account saved markups in, per week. */
  drawingsByWeek: number[];
  markupsTotal: number;
  /** Markups saved per week, this week first. */
  markupsByWeek: number[];
  exportsTotal: number;
  /** PDFs exported per week, this week first. */
  exportsByWeek: number[];
  /** Prints per week. */
  printsByWeek: number[];
  /** Place heads runs per week. */
  placementsByWeek: number[];
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
    activeDaysByWeek: weeks(row.active_days_by_week),
    drawingsByWeek: weeks(row.drawings_by_week),
    markupsTotal: row.markups_total,
    markupsByWeek: weeks(row.markups_by_week),
    exportsTotal: row.exports_total,
    exportsByWeek: weeks(row.exports_by_week),
    printsByWeek: weeks(row.prints_by_week),
    placementsByWeek: weeks(row.placements_by_week),
  }));
}

export type ActivityGroup = {
  /** null for accounts that are in no company. */
  companyId: string | null;
  companyName: string | null;
  rows: ActivityRow[];
  lastActiveAt: string | null;
  /** How many of the group's people were active at all, per week. */
  activePeopleByWeek: number[];
  /** Markup sets worked on, added up across people (each person's own sets). */
  drawingsByWeek: number[];
  markupsTotal: number;
  markupsByWeek: number[];
  exportsTotal: number;
  exportsByWeek: number[];
  printsByWeek: number[];
  placementsByWeek: number[];
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
      activePeopleByWeek: Array.from({ length: ACTIVITY_WEEKS }, (_, i) => list.filter((row) => (row.activeDaysByWeek[i] ?? 0) > 0).length),
      drawingsByWeek: sum(list.map((row) => row.drawingsByWeek)),
      markupsTotal: list.reduce((total, row) => total + row.markupsTotal, 0),
      markupsByWeek: sum(list.map((row) => row.markupsByWeek)),
      exportsTotal: list.reduce((total, row) => total + row.exportsTotal, 0),
      exportsByWeek: sum(list.map((row) => row.exportsByWeek)),
      printsByWeek: sum(list.map((row) => row.printsByWeek)),
      placementsByWeek: sum(list.map((row) => row.placementsByWeek)),
    }))
    .sort((a, b) => {
      if (a.companyId === null) return 1;
      if (b.companyId === null) return -1;
      return (a.companyName ?? "").localeCompare(b.companyName ?? "");
    });
}
