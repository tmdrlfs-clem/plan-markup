import { cx } from "@/components/ui/cx";
import { groupByCompany, WEEK_LABELS, type ActivityGroup, type ActivityRow, type ActivityScope } from "@/lib/db/activity-summary";

// Story 10.9 (FR14, FR16): who is really using the product. Counts and dates
// only: no drawing title, file name or markup content is shown or fetched.

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

/** A count; zero is muted so the busy cells stand out. */
function Count({ value, strong = false }: { value: number; strong?: boolean }) {
  return <span className={cx(value === 0 && "text-muted", strong && value !== 0 && "font-semibold")}>{value}</span>;
}

function Counts({ markupsWeek, markupsTotal, exportsByWeek, strong }: { markupsWeek: number; markupsTotal: number; exportsByWeek: number[]; strong?: boolean }) {
  return (
    <>
      <td className={NUM}>
        <Count value={markupsWeek} strong={strong} />
      </td>
      <td className={cx(NUM, "border-r border-border")}>
        <Count value={markupsTotal} strong={strong} />
      </td>
      {WEEK_LABELS.map((label, i) => (
        <td key={label} className={NUM}>
          <Count value={exportsByWeek[i] ?? 0} strong={strong} />
        </td>
      ))}
    </>
  );
}

function UserRow({ row }: { row: ActivityRow }) {
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
      <td className="whitespace-nowrap px-2 py-2.5 text-ad-sm text-muted">{lastActive(row.lastActiveAt)}</td>
      <Counts markupsWeek={row.markupsByWeek[0] ?? 0} markupsTotal={row.markupsTotal} exportsByWeek={row.exportsByWeek} />
    </tr>
  );
}

function Group({ group, scope }: { group: ActivityGroup; scope: ActivityScope }) {
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
        <td className="whitespace-nowrap px-2 py-2.5 text-ad-sm">{lastActive(group.lastActiveAt)}</td>
        <Counts markupsWeek={group.markupsByWeek[0] ?? 0} markupsTotal={group.markupsTotal} exportsByWeek={group.exportsByWeek} strong />
      </tr>
      {group.rows.map((row) => (
        <UserRow key={row.userId} row={row} />
      ))}
    </tbody>
  );
}

export type ActivityScreenProps = {
  scope: ActivityScope;
  /** The company's name, for the company scope. */
  companyName?: string;
  rows: ActivityRow[];
};

export function ActivityScreen({ scope, companyName, rows }: ActivityScreenProps) {
  const groups = groupByCompany(rows);
  const caption = scope === "company" ? `Activity of ${companyName ?? "your company"}` : "Activity by company and account";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-ad-xl font-semibold">Activity</h1>
        <p className="text-ad-sm text-muted">
          {scope === "company"
            ? `When the people of ${companyName ?? "your company"} were last active, how many markups they saved and how many PDFs they exported.`
            : "When each account was last active, how many markups it saved and how many PDFs it exported, by company."}{" "}
          Counts only: no drawings, file names or markup content.
        </p>
      </div>

      <div className="overflow-x-auto rounded border border-border bg-surface-2 shadow-1">
        <table className="w-full min-w-[700px] table-fixed border-collapse">
          <caption className="sr-only">{caption}</caption>
          <colgroup>
            <col />
            <col className="w-[104px]" />
            <col span={2} className="w-[72px]" />
            <col span={4} className="w-[72px]" />
          </colgroup>
          <thead>
            <tr className="text-ad-sm text-muted">
              <th scope="col" rowSpan={2} className="px-4 py-2 text-left align-bottom font-medium">
                {scope === "company" ? "Person" : "Company and account"}
              </th>
              <th scope="col" rowSpan={2} className="px-2 py-2 text-left align-bottom font-medium">
                Last active
              </th>
              <th scope="colgroup" colSpan={2} className="border-b border-r border-border px-2 py-2 text-center font-medium">
                Markups saved
              </th>
              <th scope="colgroup" colSpan={4} className="border-b border-border px-2 py-2 text-center font-medium">
                PDFs exported
              </th>
            </tr>
            <tr className="text-muted">
              <th scope="col" className={HEAD}>
                This week
              </th>
              <th scope="col" className={cx(HEAD, "border-r border-border")}>
                All time
              </th>
              {WEEK_LABELS.map((label) => (
                <th key={label} scope="col" className={HEAD}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((group) => (
            <Group key={group.companyId ?? "none"} group={group} scope={scope} />
          ))}
        </table>
        {rows.length === 0 ? <p className="border-t border-border px-4 py-10 text-center text-ad-sm text-muted">No accounts yet.</p> : null}
      </div>

      <p className="text-ad-sm text-muted">
        Weeks start on Monday, New Zealand time. Last active is the latest sign-in, saved markup, export or print.
      </p>
    </div>
  );
}
