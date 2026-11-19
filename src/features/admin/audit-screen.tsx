import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";
import { AUDIT_AREAS, AUDIT_PAGE_SIZE, type AuditArea, type AuditEntry, type AuditList, type AuditParty, type AuditQuery } from "@/lib/db/audit-log";
import { asPlan, PLAN_LABELS } from "@/lib/plans";

// The platform admin's audit log (NFR34): who did what to whom, newest first.
// Server-rendered and read only; areas, search and pages are links. Every value
// renders as text (React escapes it), detail included (NFR27).

const AREA_LABELS: Record<AuditArea, string> = {
  all: "All",
  user: "Accounts",
  company: "Companies",
  rules: "Rule figures",
  support: "Support",
};

/** /admin/audit with these settings; defaults (all, no search, page 1) are left out. */
export function auditHref({ area, search, page }: AuditQuery): string {
  const params = new URLSearchParams();
  if (area !== "all") params.set("area", area);
  if (search !== "") params.set("q", search);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query === "" ? "/admin/audit" : `/admin/audit?${query}`;
}

const TIME_FORMAT = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Pacific/Auckland",
});

export function auditTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : TIME_FORMAT.format(date);
}

const ROLE_LABELS: Record<string, string> = { admin: "admin", member: "member", viewer: "viewer" };
const STATUS_LABELS: Record<string, string> = { pending: "waiting", active: "active", deactivated: "deactivated" };

function text(value: unknown, labels?: Record<string, string>): string {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string" || value === "") return "?";
  return labels?.[value] ?? value;
}

function plan(value: unknown): string {
  return typeof value === "string" ? PLAN_LABELS[asPlan(value)] : "?";
}

function Party({ party }: { party: AuditParty }) {
  return (
    <span className={cx("font-medium", !party.known && "text-muted")} title={party.email ?? party.id}>
      {party.label}
    </span>
  );
}

/** The entry as a sentence, the actor left out (shown in its own column). Unknown actions show their code. */
export function describeAudit(entry: AuditEntry): ReactNode {
  const d = entry.detail;
  const mention = (key: string) => {
    const id = d[key];
    const party = typeof id === "string" ? entry.people[id] : undefined;
    return party ? <Party party={party} /> : <span className="text-muted">someone</span>;
  };
  switch (entry.action) {
    case "user.activated":
      return `Activated the account (was ${text(d.from, STATUS_LABELS)})`;
    case "user.deactivated":
      return `Deactivated the account (was ${text(d.from, STATUS_LABELS)})`;
    case "user.plan_changed":
    case "company.plan_changed":
      return `Changed the plan: ${plan(d.from)} → ${plan(d.to)}`;
    case "company.created":
      return <>Created the company, first admin {mention("admin_user_id")}</>;
    case "company.member_invited":
      return `Invited someone as ${text(d.role, ROLE_LABELS)}`;
    case "company.invitation_revoked":
      return "Withdrew an invitation";
    case "company.member_joined":
      return `Joined as ${text(d.role, ROLE_LABELS)}`;
    case "company.member_role_changed":
      return (
        <>
          Changed the role of {mention("user_id")}: {text(d.from, ROLE_LABELS)} → {text(d.to, ROLE_LABELS)}
        </>
      );
    case "company.member_removed":
      return (
        <>
          Removed {mention("user_id")} ({text(d.role, ROLE_LABELS)})
        </>
      );
    case "company.tool_set_published":
      return `Published the tool set "${text(d.name)}" to the company`;
    case "company.tool_set_withdrawn":
      return `Withdrew the tool set "${text(d.name)}" from the company`;
    case "company.use_hazard_map_changed":
      return `Changed the company's use → hazard map (version ${text(d.version)})`;
    case "company.use_hazard_map_reset":
      return "Reset the company's use → hazard map to the platform default";
    case "support.markup_sets_viewed":
      return `Looked up the account's markup sets (${text(d.sets)} ${d.sets === 1 ? "set" : "sets"})`;
    case "rules.figures_created":
      return `Drafted rule figures version ${text(d.version)}${typeof d.from_version === "number" ? ` from version ${d.from_version}` : ""}`;
    case "rules.figures_verified":
      return `Confirmed rule figures version ${text(d.version)}; the app now uses it`;
    case "rules.use_hazard_map_changed":
      return `Drafted the default use → hazard map version ${text(d.version)}`;
    case "rules.use_hazard_map_verified":
      return `Confirmed the default use → hazard map version ${text(d.version)}; the app now uses it`;
    default:
      return <code className="font-mono text-[12px]">{entry.action}</code>;
  }
}

function EntryRow({ entry }: { entry: AuditEntry }) {
  const hasDetail = Object.keys(entry.detail).length > 0;
  return (
    <tr className="border-t border-border align-top">
      <td className="whitespace-nowrap px-4 py-3 text-ad-sm tabular-nums text-muted">
        <time dateTime={entry.occurredAt}>{auditTime(entry.occurredAt)}</time>
      </td>
      <th scope="row" className="max-w-0 px-4 py-3 text-left text-ad-sm font-normal">
        <span className="block truncate">
          <Party party={entry.actor} />
        </span>
        {entry.actor.email && entry.actor.email !== entry.actor.label ? (
          <span className="block truncate text-muted">{entry.actor.email}</span>
        ) : null}
      </th>
      <td className="px-4 py-3 text-ad-sm">
        <p>{describeAudit(entry)}</p>
        {hasDetail ? (
          <details className="mt-1">
            <summary className="w-fit cursor-pointer rounded text-[12px] font-medium text-muted underline underline-offset-2 focus-ring">
              Details
            </summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-sm border border-border bg-surface-1 p-2 font-mono text-[12px] text-text">
              {JSON.stringify(entry.detail, null, 2)}
            </pre>
          </details>
        ) : null}
      </td>
      <td className="max-w-0 px-4 py-3 text-ad-sm">
        <span className="block truncate">
          <Party party={entry.target} />
        </span>
        {entry.target.email && entry.target.email !== entry.target.label ? (
          <span className="block truncate text-muted">{entry.target.email}</span>
        ) : null}
      </td>
    </tr>
  );
}

const LINK_BUTTON = "rounded border border-strong px-3 py-1.5 font-medium text-text focus-ring hover:bg-surface-3";

export type AuditScreenProps = { query: AuditQuery; list: AuditList };

/** /admin/audit: the audit log for the platform admin. */
export function AuditScreen({ query, list }: AuditScreenProps) {
  const pages = Math.max(1, Math.ceil(list.total / AUDIT_PAGE_SIZE));
  const first = list.total === 0 ? 0 : (query.page - 1) * AUDIT_PAGE_SIZE + 1;
  const last = Math.min(list.total, query.page * AUDIT_PAGE_SIZE);
  const searching = query.search !== "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-ad-xl font-semibold">Audit log</h1>
        <p className="text-ad-sm text-muted">
          Every change made by an admin, and every lookup of someone&apos;s markup sets, newest first. Entries cannot be changed or
          deleted. Times are New Zealand time.
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <nav aria-label="Filter by area">
          <ul className="flex flex-wrap gap-1">
            {AUDIT_AREAS.map((area) => {
              const current = area === query.area;
              return (
                <li key={area}>
                  <Link
                    href={auditHref({ area, search: query.search, page: 1 })}
                    aria-current={current ? "page" : undefined}
                    className={cx(
                      "inline-flex h-10 items-center rounded border px-3 text-ad-sm font-medium focus-ring",
                      current ? "border-strong bg-surface-2 text-text" : "border-transparent text-muted hover:bg-surface-3 hover:text-text",
                    )}
                  >
                    {AREA_LABELS[area]}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <form action="/admin/audit" method="get" role="search" className="flex items-end gap-2">
          {query.area !== "all" ? <input type="hidden" name="area" value={query.area} /> : null}
          <label className="flex flex-col gap-1 text-ad-sm font-medium">
            Person or company
            <input
              type="search"
              name="q"
              defaultValue={query.search}
              maxLength={100}
              placeholder="Name or email"
              className="h-10 w-64 max-w-full rounded border border-strong bg-surface-2 px-3 text-ad-sm font-normal text-text focus-ring"
            />
          </label>
          <button
            type="submit"
            className="inline-flex h-10 items-center rounded border border-strong px-4 text-ad-sm font-medium text-text focus-ring hover:bg-surface-3"
          >
            Search
          </button>
          {searching ? (
            <Link
              href={auditHref({ area: query.area, search: "", page: 1 })}
              className="inline-flex h-10 items-center rounded px-2 text-ad-sm font-medium text-text underline underline-offset-2 focus-ring"
            >
              Clear
            </Link>
          ) : null}
        </form>
      </div>

      {list.searchTruncated ? (
        <p role="note" className="rounded border border-border bg-surface-2 px-4 py-3 text-ad-sm">
          &quot;{query.search}&quot; matches more than 200 people or companies; only the first 200 are searched. Type more of the name
          or email.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded border border-border bg-surface-2 shadow-1">
        <table className="w-full min-w-[760px] table-fixed border-collapse">
          <caption className="sr-only">
            Audit log, {AREA_LABELS[query.area].toLowerCase()}
            {searching ? `, involving "${query.search}"` : ""}
          </caption>
          <colgroup>
            <col className="w-[170px]" />
            <col className="w-[200px]" />
            <col />
            <col className="w-[200px]" />
          </colgroup>
          <thead>
            <tr className="bg-surface-1 text-left text-ad-sm text-muted">
              <th scope="col" className="px-4 py-2.5 font-medium">
                When
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Who
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                What
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                On
              </th>
            </tr>
          </thead>
          <tbody>
            {list.entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </tbody>
        </table>
        {list.entries.length === 0 ? (
          <p className="border-t border-border px-4 py-10 text-center text-ad-sm text-muted">
            {searching ? `Nothing here involves "${query.search}".` : "Nothing recorded here yet."}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-ad-sm text-muted">
        <p role="status">{list.total === 0 ? "0 entries" : `${first}–${last} of ${list.total} ${list.total === 1 ? "entry" : "entries"}`}</p>
        {pages > 1 ? (
          <nav aria-label="Pages" className="flex items-center gap-2">
            {query.page > 1 ? (
              <Link href={auditHref({ ...query, page: query.page - 1 })} className={LINK_BUTTON}>
                Previous
              </Link>
            ) : null}
            <span>
              Page {query.page} of {pages}
            </span>
            {query.page < pages ? (
              <Link href={auditHref({ ...query, page: query.page + 1 })} className={LINK_BUTTON}>
                Next
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
