import type { SupportSet } from "@/lib/db/support-lookup";

// Story 10.10 (FR15): an account's markup sets, for support. Names and counts
// only; there is no way from here to a drawing, a page or a markup.

const DATE_FORMAT = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Pacific/Auckland",
});

function when(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DATE_FORMAT.format(date);
}

export type SupportAccount = { name: string; email: string; status: "pending" | "active" | "deactivated" };

const STATUS_NOTES = { pending: "Waiting for approval", active: "Active", deactivated: "Deactivated" } as const;

export function SupportScreen({ account, sets }: { account: SupportAccount; sets: SupportSet[] }) {
  const name = account.name.trim();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        {/* A plain link: the accounts list is not fetched ahead of a click. */}
        <a href="/admin/users?status=all" className="self-start rounded text-ad-sm font-medium text-text underline underline-offset-2 focus-ring">
          Back to accounts
        </a>
        <h1 className="text-ad-xl font-semibold">Markup sets of {name === "" ? account.email : name}</h1>
        <p className="text-ad-sm text-muted">
          {account.email} · {STATUS_NOTES[account.status]}
        </p>
      </div>

      <p className="rounded border border-border bg-surface-1 px-4 py-3 text-ad-sm">
        For support only. You see file names and counts, never the drawing or the markups themselves. This lookup has been recorded in
        the audit log.
      </p>

      <div className="overflow-x-auto rounded border border-border bg-surface-2 shadow-1">
        <table className="w-full min-w-[640px] table-fixed border-collapse">
          <caption className="sr-only">Markup sets of {name === "" ? account.email : name}</caption>
          <colgroup>
            <col />
            <col className="w-[80px]" />
            <col className="w-[96px]" />
            <col className="w-[190px]" />
          </colgroup>
          <thead>
            <tr className="bg-surface-1 text-left text-ad-sm text-muted">
              <th scope="col" className="px-4 py-2.5 font-medium">
                File name
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Pages
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Markups
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Last saved
              </th>
            </tr>
          </thead>
          <tbody>
            {sets.map((set) => (
              <tr key={set.id} className="border-t border-border align-middle">
                <th scope="row" className="max-w-0 px-4 py-3 text-left font-normal">
                  <span className="block truncate text-ad-sm font-medium" title={set.filename}>
                    {set.filename}
                  </span>
                  {set.fileCount > 1 ? <span className="block text-ad-sm text-muted">{set.fileCount} file versions; the newest is shown</span> : null}
                </th>
                <td className="px-4 py-3 text-right text-ad-sm tabular-nums">
                  {set.pageCount === null ? <span className="text-muted">No file</span> : set.pageCount}
                </td>
                <td className="px-4 py-3 text-right text-ad-sm tabular-nums">{set.markupCount}</td>
                <td className="whitespace-nowrap px-4 py-3 text-ad-sm text-muted">{when(set.lastSavedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sets.length === 0 ? <p className="border-t border-border px-4 py-10 text-center text-ad-sm text-muted">This account has no markup sets.</p> : null}
      </div>

      <p role="status" className="text-ad-sm text-muted">
        {sets.length === 1 ? "1 markup set" : `${sets.length} markup sets`}
        {sets.length >= 500 ? " (the 500 saved most recently)" : ""}. Times are New Zealand time.
      </p>
    </div>
  );
}
