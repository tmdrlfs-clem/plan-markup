import { ADMIN_COMPANIES_LIMIT, type AdminCompanyRow } from "@/lib/db/admin-companies";
import { CreateCompanyForm } from "./create-company-form";

const DATE_FORMAT = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Pacific/Auckland",
});

function created(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DATE_FORMAT.format(date);
}

function CompanyRow({ row }: { row: AdminCompanyRow }) {
  return (
    <tr className="border-t border-border align-top">
      <th scope="row" className="max-w-0 px-4 py-3 text-left font-normal">
        <span className="block truncate text-ad-sm font-medium" title={row.name}>
          {row.name}
        </span>
      </th>
      <td className="max-w-0 px-4 py-3">
        {row.admins.length === 0 ? (
          <span className="text-ad-sm text-muted">No admin</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {row.admins.map((admin) => (
              <li key={admin.email} className="min-w-0">
                {admin.name.trim() !== "" ? <span className="block truncate text-ad-sm">{admin.name.trim()}</span> : null}
                <span className="block truncate text-ad-sm text-muted" title={admin.email}>
                  {admin.email}
                </span>
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="px-4 py-3 text-right text-ad-sm tabular-nums">{row.memberCount}</td>
      <td className="whitespace-nowrap px-4 py-3 text-ad-sm text-muted">{created(row.createdAt)}</td>
    </tr>
  );
}

/** Story 10.5: the platform admin's company list and the form that adds one (FR11). */
export function CompaniesScreen({ companies }: { companies: AdminCompanyRow[] }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-ad-xl font-semibold">Companies</h1>
        <p className="text-ad-sm text-muted">
          A company groups the people who work together. Each person belongs to one company at most.
        </p>
      </div>

      <CreateCompanyForm />

      <div className="overflow-x-auto rounded border border-border bg-surface-2 shadow-1">
        <table className="w-full min-w-[640px] table-fixed border-collapse">
          <caption className="sr-only">Companies</caption>
          <colgroup>
            <col />
            <col />
            <col className="w-[110px]" />
            <col className="w-[130px]" />
          </colgroup>
          <thead>
            <tr className="bg-surface-1 text-left text-ad-sm text-muted">
              <th scope="col" className="px-4 py-2.5 font-medium">
                Company
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Admins
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Members
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {companies.map((row) => (
              <CompanyRow key={row.id} row={row} />
            ))}
          </tbody>
        </table>
        {companies.length === 0 ? (
          <p className="border-t border-border px-4 py-10 text-center text-ad-sm text-muted">No companies yet. Create the first one above.</p>
        ) : null}
      </div>

      <p role="status" className="text-ad-sm text-muted">
        {companies.length === 1 ? "1 company" : `${companies.length} companies`}
        {companies.length >= ADMIN_COMPANIES_LIMIT ? ` (the first ${ADMIN_COMPANIES_LIMIT} by name)` : ""}
      </p>
    </div>
  );
}
