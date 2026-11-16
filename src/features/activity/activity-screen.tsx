import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";
import {
  groupByCompany,
  WEEK_LABELS,
  type ActivityGroup,
  type ActivityRow,
  type ActivityScope,
  type ActivityView,
} from "@/lib/db/activity-summary";

// Story 10.9 (FR14, FR16): who is really using the product. Two views of the
// same rows: this week by kind of work, and markups and PDFs across four
// weeks. Counts and dates only: no drawing title, file name or markup content
// is shown or fetched.

const DATE_FORMAT = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Pacific/Auckland",
});

export function lastActive(iso: string | null): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Never" : DATE_FORMAT.format(date);
}

const NUM = "px-2 py-2.5 text-right text-ad-sm tabular-nums";
const HEAD = "px-2 py-2 text-right text-[12px] font-medium";
const DIVIDE = "border-r border-border";

/** A count; zero is muted so the busy cells stand out. */
function Count({ value, strong = false }: { value: number; strong?: boolean }) {
  return <span className={cx(value === 0 && "text-muted", strong && value !== 0 && "font-semibold")}>{value}</span>;
}

function Num({ value, strong, divide }: { value: number; strong?: boolean; divide?: boolean }) {
  return (
    <td className={cx(NUM, divide && DIVIDE)}>
      <Count value={value} strong={strong} />
    </td>
  );
}

/** The cells after the name, for a person or for a group's totals. */
type Figures = {
  lastActiveAt: string | null;
  /** "3 of 7" for a person's days, "2 of 5" for a group's active people. */
  active: ReactNode;
  drawingsByWeek: number[];
  markupsTotal: number;
  markupsByWeek: number[];
  exportsByWeek: number[];
  printsByWeek: number[];
  placementsByWeek: number[];
};

function Cells({ view, figures, strong }: { view: ActivityView; figures: Figures; strong?: boolean }) {
  if (view === "weeks") {
    return (
      <>
        {WEEK_LABELS.map((label, i) => (
          <Num key={`m${label}`} value={figures.markupsByWeek[i] ?? 0} strong={strong} />
        ))}
        <Num value={figures.markupsTotal} strong={strong} divide />
        {WEEK_LABELS.map((label, i) => (
          <Num key={`x${label}`} value={figures.exportsByWeek[i] ?? 0} strong={strong} />
        ))}
      </>
    );
  }
  return (
    <>
      <td className={cx("whitespace-nowrap px-2 py-2.5 text-ad-sm", !strong && "text-muted")}>{lastActive(figures.lastActiveAt)}</td>
      <td className={cx(NUM, DIVIDE, "whitespace-nowrap")}>{figures.active}</td>
      <Num value={figures.drawingsByWeek[0] ?? 0} strong={strong} />
      <Num value={figures.markupsByWeek[0] ?? 0} strong={strong} />
      <Num value={figures.exportsByWeek[0] ?? 0} strong={strong} />
      <Num value={figures.printsByWeek[0] ?? 0} strong={strong} />
      <Num value={figures.placementsByWeek[0] ?? 0} strong={strong} />
    </>
  );
}

function Fraction({ value, of, strong }: { value: number; of: number; strong?: boolean }) {
  return (
    <>
      <Count value={value} strong={strong} />
      <span className="text-muted"> of {of}</span>
    </>
  );
}

function UserRow({ row, view }: { row: ActivityRow; view: ActivityView }) {
  const name = row.name.trim();
  return (
    <tr className="border-t border-border align-middle">
      <th scope="row" className="max-w-0 py-2.5 pl-8 pr-2 text-left font-normal">
        <span className={cx("block truncate text-ad-sm", name === "" ? "text-muted" : "font-medium")}>{name === "" ? "No name yet" : name}</span>
        <span className="block truncate text-ad-sm text-muted" title={row.email}>
          {row.email}
          {row.status === "active" ? "" : row.status === "pending" ? " · waiting for approval" : " · deactivated"}
        </span>
      </th>
      <Cells view={view} figures={{ ...row, active: <Fraction value={row.activeDaysByWeek[0] ?? 0} of={7} /> }} />
    </tr>
  );
}

function Group({ group, scope, view }: { group: ActivityGroup; scope: ActivityScope; view: ActivityView }) {
  const label = scope === "company" ? "Whole company" : (group.companyName ?? "Individual accounts");
  const people = group.rows.length === 1 ? "1 person" : `${group.rows.length} people`;
  return (
    <tbody>
      <tr className="border-t border-strong bg-surface-1 align-middle">
        <th scope="rowgroup" className="max-w-0 px-4 py-2.5 text-left">
          <span className="block truncate text-ad-sm font-semibold" title={label}>
            {label}
          </span>
          <span className="block text-[12px] font-normal text-muted">{people}</span>
        </th>
        <Cells
          view={view}
          strong
          figures={{ ...group, active: <Fraction value={group.activePeopleByWeek[0] ?? 0} of={group.rows.length} strong /> }}
        />
      </tr>
      {group.rows.map((row) => (
        <UserRow key={row.userId} row={row} view={view} />
      ))}
    </tbody>
  );
}

const VIEWS: { view: ActivityView; label: string }[] = [
  { view: "week", label: "This week" },
  { view: "weeks", label: "Four weeks" },
];

export type ActivityScreenProps = {
  scope: ActivityScope;
  view: ActivityView;
  /** /admin/activity or /company/activity: where the view links lead. */
  basePath: string;
  /** The company's name, for the company scope. */
  companyName?: string;
  rows: ActivityRow[];
};

export function ActivityScreen({ scope, view, basePath, companyName, rows }: ActivityScreenProps) {
  const groups = groupByCompany(rows);
  const who = scope === "company" ? `Activity of ${companyName ?? "your company"}` : "Activity by company and account";
  const caption = `${who}, ${view === "week" ? "this week" : "the last four weeks"}`;
  const first = scope === "company" ? "Person" : "Company and account";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-ad-xl font-semibold">Activity</h1>
        <p className="text-ad-sm text-muted">
          {scope === "company" ? `How much the people of ${companyName ?? "your company"} used Plan Markup.` : "How much each company and account used Plan Markup."}{" "}
          Counts only: no drawings, file names or markup content.
        </p>
      </div>

      <nav aria-label="View">
        <ul className="flex flex-wrap gap-1">
          {VIEWS.map((item) => {
            const current = item.view === view;
            return (
              <li key={item.view}>
                <Link
                  href={item.view === "week" ? basePath : `${basePath}?view=${item.view}`}
                  aria-current={current ? "page" : undefined}
                  className={cx(
                    "inline-flex h-10 items-center rounded border px-3 text-ad-sm font-medium focus-ring",
                    current ? "border-strong bg-surface-2 text-text" : "border-transparent text-muted hover:bg-surface-3 hover:text-text",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="overflow-x-auto rounded border border-border bg-surface-2 shadow-1">
        <table className="w-full min-w-[700px] table-fixed border-collapse">
          <caption className="sr-only">{caption}</caption>
          {view === "week" ? (
            <>
              <colgroup>
                <col />
                <col className="w-[104px]" />
                <col className="w-[76px]" />
                <col span={5} className="w-[68px]" />
              </colgroup>
              <thead>
                <tr className="text-muted">
                  <th scope="col" className="px-4 py-2 text-left align-bottom text-ad-sm font-medium">
                    {first}
                  </th>
                  <th scope="col" className="px-2 py-2 text-left align-bottom text-ad-sm font-medium">
                    Last active
                  </th>
                  <th scope="col" className={cx(HEAD, DIVIDE, "align-bottom")}>
                    Days active
                  </th>
                  <th scope="col" className={cx(HEAD, "align-bottom")}>
                    Drawings
                  </th>
                  <th scope="col" className={cx(HEAD, "align-bottom")}>
                    Markups saved
                  </th>
                  <th scope="col" className={cx(HEAD, "align-bottom")}>
                    PDFs exported
                  </th>
                  <th scope="col" className={cx(HEAD, "align-bottom")}>
                    Prints
                  </th>
                  <th scope="col" className={cx(HEAD, "align-bottom")}>
                    Head layouts
                  </th>
                </tr>
              </thead>
            </>
          ) : (
            <>
              <colgroup>
                <col />
                <col span={5} className="w-[60px]" />
                <col span={4} className="w-[60px]" />
              </colgroup>
              <thead>
                <tr className="text-ad-sm text-muted">
                  <th scope="col" rowSpan={2} className="px-4 py-2 text-left align-bottom font-medium">
                    {first}
                  </th>
                  <th scope="colgroup" colSpan={5} className={cx("border-b border-border px-2 py-2 text-center font-medium", DIVIDE)}>
                    Markups saved
                  </th>
                  <th scope="colgroup" colSpan={4} className="border-b border-border px-2 py-2 text-center font-medium">
                    PDFs exported
                  </th>
                </tr>
                <tr className="text-muted">
                  {WEEK_LABELS.map((label) => (
                    <th key={`m${label}`} scope="col" className={HEAD}>
                      {label}
                    </th>
                  ))}
                  <th scope="col" className={cx(HEAD, DIVIDE)}>
                    All time
                  </th>
                  {WEEK_LABELS.map((label) => (
                    <th key={`x${label}`} scope="col" className={HEAD}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
            </>
          )}
          {groups.map((group) => (
            <Group key={group.companyId ?? "none"} group={group} scope={scope} view={view} />
          ))}
        </table>
        {rows.length === 0 ? <p className="border-t border-border px-4 py-10 text-center text-ad-sm text-muted">No accounts yet.</p> : null}
      </div>

      <div className="flex flex-col gap-1 text-ad-sm text-muted">
        <p>Weeks start on Monday, New Zealand time.</p>
        {view === "week" ? (
          <>
            <p>
              Days active: days this week with a saved markup, an export, a print or a head layout. A company&apos;s row shows how many of
              its people were active.
            </p>
            <p>Drawings: different drawings the person saved markups on. Head layouts: times Place heads was run.</p>
            <p>Last active also counts signing in.</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
