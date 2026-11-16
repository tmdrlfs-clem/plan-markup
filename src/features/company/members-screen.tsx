import { ROLE_LABELS, type CompanyInvitation, type CompanyMember } from "@/lib/db/companies";
import { InviteForm, RevokeInvitationButton } from "./invite-form";
import { MemberControls, ONLY_ADMIN_NOTE } from "./member-controls";

const DATE_FORMAT = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Pacific/Auckland",
});

function day(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DATE_FORMAT.format(date);
}

const TH = "px-4 py-2.5 font-medium";
const TABLE_WRAP = "overflow-x-auto rounded border border-border bg-surface-2 shadow-1";

export type MembersScreenProps = {
  companyName: string;
  currentUserId: string;
  members: CompanyMember[];
  invitations: CompanyInvitation[];
};

/** Story 10.6: Company → Members for the company's admins: who is in, who is invited, and the invite form (FR6). */
export function MembersScreen({ companyName, currentUserId, members, invitations }: MembersScreenProps) {
  const adminCount = members.filter((member) => member.role === "admin").length;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-ad-xl font-semibold">Members</h1>
        <p className="text-ad-sm text-muted">
          The people of {companyName}. Someone you invite joins as soon as they open the link from their email. Changing a role or
          removing someone applies at once and signs them out; their own markup sets stay with them.
        </p>
      </div>

      <InviteForm />

      <section aria-labelledby="members-heading" className="flex flex-col gap-3">
        <h2 id="members-heading" className="text-ad-md font-semibold">
          Members <span className="font-normal text-muted">({members.length})</span>
        </h2>
        <div className={TABLE_WRAP}>
          <table className="w-full min-w-[640px] table-fixed border-collapse">
            <caption className="sr-only">Members of {companyName}</caption>
            <colgroup>
              <col />
              <col className="w-[130px]" />
              <col className="w-[250px]" />
            </colgroup>
            <thead>
              <tr className="bg-surface-1 text-left text-ad-sm text-muted">
                <th scope="col" className={TH}>
                  Name and email
                </th>
                <th scope="col" className={TH}>
                  Joined
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Role and membership
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const name = member.name.trim();
                const onlyAdmin = member.role === "admin" && adminCount === 1;
                return (
                  <tr key={member.userId} className="border-t border-border align-middle">
                    <th scope="row" className="max-w-0 px-4 py-3 text-left font-normal">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={name === "" ? "truncate text-ad-sm font-medium text-muted" : "truncate text-ad-sm font-medium"}>
                          {name === "" ? "No name yet" : name}
                        </span>
                        {member.userId === currentUserId ? (
                          <span className="shrink-0 rounded-sm border border-border bg-surface-3 px-1.5 py-0.5 text-[12px] font-medium text-muted">
                            You
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate text-ad-sm text-muted" title={member.email}>
                        {member.email}
                      </span>
                    </th>
                    <td className="whitespace-nowrap px-4 py-3 text-ad-sm text-muted">{day(member.joinedAt)}</td>
                    <td className="px-4 py-3">
                      <MemberControls
                        userId={member.userId}
                        label={name === "" ? member.email : name}
                        role={member.role}
                        isSelf={member.userId === currentUserId}
                        onlyAdmin={onlyAdmin}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {adminCount === 1 ? <p className="text-ad-sm text-muted">{ONLY_ADMIN_NOTE}</p> : null}
      </section>

      <section aria-labelledby="invitations-heading" className="flex flex-col gap-3">
        <h2 id="invitations-heading" className="text-ad-md font-semibold">
          Invitations <span className="font-normal text-muted">({invitations.length})</span>
        </h2>
        <div className={TABLE_WRAP}>
          <table className="w-full min-w-[560px] table-fixed border-collapse">
            <caption className="sr-only">Invitations of {companyName} that are not accepted yet</caption>
            <colgroup>
              <col />
              <col className="w-[120px]" />
              <col className="w-[170px]" />
              <col className="w-[130px]" />
            </colgroup>
            <thead>
              <tr className="bg-surface-1 text-left text-ad-sm text-muted">
                <th scope="col" className={TH}>
                  Email
                </th>
                <th scope="col" className={TH}>
                  Role
                </th>
                <th scope="col" className={TH}>
                  Expires
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((invitation) => (
                <tr key={invitation.id} className="border-t border-border align-middle">
                  <th scope="row" className="max-w-0 px-4 py-3 text-left font-normal">
                    <span className="block truncate text-ad-sm font-medium" title={invitation.email}>
                      {invitation.email}
                    </span>
                  </th>
                  <td className="px-4 py-3 text-ad-sm">{ROLE_LABELS[invitation.role]}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ad-sm text-muted">
                    {invitation.expired ? <span className="font-medium text-warning-text">Expired {day(invitation.expiresAt)}</span> : day(invitation.expiresAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <RevokeInvitationButton invitationId={invitation.id} email={invitation.email} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {invitations.length === 0 ? (
            <p className="border-t border-border px-4 py-8 text-center text-ad-sm text-muted">No invitations are waiting.</p>
          ) : null}
        </div>
        <p className="text-ad-sm text-muted">Inviting an address again sends a new link and cancels the earlier one.</p>
      </section>
    </div>
  );
}
