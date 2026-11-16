import Link from "next/link";

import { cx } from "@/components/ui/cx";
import {
  ADMIN_USER_FILTERS,
  ADMIN_USERS_PAGE_SIZE,
  type AdminUserFilter,
  type AdminUserList,
  type AdminUserQuery,
  type AdminUserRow,
} from "@/lib/db/admin-users";
import type { ProfileStatus } from "@/lib/db/profiles";
import { PlanSelect } from "./plan-select";
import { UserStatusAction } from "./user-status-action";

const FILTER_LABELS: Record<AdminUserFilter, string> = {
  pending: "Waiting for approval",
  active: "Active",
  deactivated: "Deactivated",
  all: "All",
};

const STATUS_LABELS: Record<ProfileStatus, string> = {
  pending: "Waiting",
  active: "Active",
  deactivated: "Deactivated",
};

// Colour is never the only signal: each status has its own word and mark.
const STATUS_STYLES: Record<ProfileStatus, { dot: string; text: string }> = {
  pending: { dot: "bg-warning", text: "text-warning-text" },
  active: { dot: "bg-success", text: "text-success" },
  deactivated: { dot: "border border-strong bg-transparent", text: "text-muted" },
};

/** /admin/users with these settings; defaults (pending, no search, page 1) are left out. */
export function usersHref({ filter, search, page }: AdminUserQuery): string {
  const params = new URLSearchParams();
  if (filter !== "pending") params.set("status", filter);
  if (search !== "") params.set("q", search);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query === "" ? "/admin/users" : `/admin/users?${query}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Pacific/Auckland",
});

function signedUp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DATE_FORMAT.format(date);
}

function StatusBadge({ status }: { status: ProfileStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span className={cx("inline-flex items-center gap-2 whitespace-nowrap text-ad-sm font-medium", style.text)}>
      <span aria-hidden="true" className={cx("size-2 shrink-0 rounded-sm", style.dot)} />
      {STATUS_LABELS[status]}
    </span>
  );
}

function UserRow({ row, adminId }: { row: AdminUserRow; adminId: string }) {
  const name = row.name.trim();
  const label = name === "" ? row.email : name;
  return (
    <tr className="border-t border-border align-middle">
      <th scope="row" className="max-w-0 px-4 py-3 text-left font-normal">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cx("truncate text-ad-sm font-medium", name === "" && "text-muted")} title={name === "" ? undefined : name}>
            {name === "" ? "No name yet" : name}
          </span>
          {row.isPlatformAdmin ? (
            <span className="shrink-0 rounded-sm border border-border bg-surface-3 px-1.5 py-0.5 text-[12px] font-medium text-muted">
              Admin
            </span>
          ) : null}
        </span>
        <span className="block truncate text-ad-sm text-muted" title={row.email}>
          {row.email}
        </span>
      </th>
      <td className="px-4 py-3">
        <StatusBadge status={row.status} />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-ad-sm text-muted">{signedUp(row.createdAt)}</td>
      <td className="px-3 py-3">
        <PlanSelect targetType="user" targetId={row.id} label={label} plan={row.plan} />
      </td>
      <td className="px-4 py-3 text-right">
        <UserStatusAction userId={row.id} label={label} status={row.status} isSelf={row.id === adminId} />
      </td>
    </tr>
  );
}

const EMPTY_COPY: Record<AdminUserFilter, string> = {
  pending: "No one is waiting for approval.",
  active: "No active accounts.",
  deactivated: "No deactivated accounts.",
  all: "No accounts yet.",
};

const LINK_BUTTON = "rounded border border-strong px-3 py-1.5 font-medium text-text focus-ring hover:bg-surface-3";

export type UsersScreenProps = { adminId: string; query: AdminUserQuery; list: AdminUserList };

/** Story 10.4: the platform admin's account list (FR12). Server-rendered; filters, search and pages are links. */
export function UsersScreen({ adminId, query, list }: UsersScreenProps) {
  const pages = Math.max(1, Math.ceil(list.total / ADMIN_USERS_PAGE_SIZE));
  const first = list.total === 0 ? 0 : (query.page - 1) * ADMIN_USERS_PAGE_SIZE + 1;
  const last = Math.min(list.total, query.page * ADMIN_USERS_PAGE_SIZE);
  const allCount = list.counts.pending + list.counts.active + list.counts.deactivated;
  const count = (filter: AdminUserFilter) => (filter === "all" ? allCount : list.counts[filter]);
  const searching = query.search !== "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-ad-xl font-semibold">Accounts</h1>
        <p className="text-ad-sm text-muted">
          New sign-ups wait here until you activate them. Deactivating signs the person out at once; nothing is deleted. The plan
          here belongs to the account itself; someone in a company works under the plan of that company.
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <nav aria-label="Filter by status">
          <ul className="flex flex-wrap gap-1">
            {ADMIN_USER_FILTERS.map((filter) => {
              const current = filter === query.filter;
              return (
                <li key={filter}>
                  <Link
                    href={usersHref({ filter, search: query.search, page: 1 })}
                    aria-current={current ? "page" : undefined}
                    className={cx(
                      "inline-flex h-10 items-center gap-2 rounded border px-3 text-ad-sm font-medium focus-ring",
                      current
                        ? "border-strong bg-surface-2 text-text"
                        : "border-transparent text-muted hover:bg-surface-3 hover:text-text",
                    )}
                  >
                    {FILTER_LABELS[filter]}
                    <span className="rounded-sm bg-surface-3 px-1.5 text-[12px] tabular-nums text-muted">{count(filter)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <form action="/admin/users" method="get" role="search" className="flex items-end gap-2">
          {query.filter !== "pending" ? <input type="hidden" name="status" value={query.filter} /> : null}
          <label className="flex flex-col gap-1 text-ad-sm font-medium">
            Search name or email
            <input
              type="search"
              name="q"
              defaultValue={query.search}
              maxLength={100}
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
              href={usersHref({ filter: query.filter, search: "", page: 1 })}
              className="inline-flex h-10 items-center rounded px-2 text-ad-sm font-medium text-text underline underline-offset-2 focus-ring"
            >
              Clear
            </Link>
          ) : null}
        </form>
      </div>

      <div className="overflow-x-auto rounded border border-border bg-surface-2 shadow-1">
        <table className="w-full min-w-[700px] table-fixed border-collapse">
          <caption className="sr-only">
            {FILTER_LABELS[query.filter]} accounts{searching ? ` matching "${query.search}"` : ""}
          </caption>
          <colgroup>
            <col />
            <col className="w-[130px]" />
            <col className="w-[120px]" />
            <col className="w-[124px]" />
            <col className="w-[140px]" />
          </colgroup>
          <thead>
            <tr className="bg-surface-1 text-left text-ad-sm text-muted">
              <th scope="col" className="px-4 py-2.5 font-medium">
                Name and email
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Signed up
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Plan
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((row) => (
              <UserRow key={row.id} row={row} adminId={adminId} />
            ))}
          </tbody>
        </table>
        {list.rows.length === 0 ? (
          <p className="border-t border-border px-4 py-10 text-center text-ad-sm text-muted">
            {searching ? `No accounts here match "${query.search}".` : EMPTY_COPY[query.filter]}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-ad-sm text-muted">
        <p role="status">
          {list.total === 0 ? "0 accounts" : `${first}–${last} of ${list.total} ${list.total === 1 ? "account" : "accounts"}`}
        </p>
        {pages > 1 ? (
          <nav aria-label="Pages" className="flex items-center gap-2">
            {query.page > 1 ? (
              <Link href={usersHref({ ...query, page: query.page - 1 })} className={LINK_BUTTON}>
                Previous
              </Link>
            ) : null}
            <span>
              Page {query.page} of {pages}
            </span>
            {query.page < pages ? (
              <Link href={usersHref({ ...query, page: query.page + 1 })} className={LINK_BUTTON}>
                Next
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
