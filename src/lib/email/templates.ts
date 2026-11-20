// The mail the app sends itself. Plain, with a text part; the same look as the
// Auth templates in supabase/templates.

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const YOU_ARE_IN_SUBJECT = "You're in: your Plan Markup account is active";

/** Story 10.4: sent when the platform admin activates an account. */
export function youAreInMail({ name, appUrl }: { name: string; appUrl: string }): { subject: string; text: string; html: string } {
  const signIn = `${appUrl}/sign-in`;
  const greeting = name.trim() === "" ? "Hello," : `Hello ${name.trim()},`;
  const text = [
    greeting,
    "",
    "Your Plan Markup account has been activated. Sign in to open your workspace:",
    signIn,
    "",
    "If you did not create this account, you can ignore this email.",
    "",
    "Plan Markup",
  ].join("\n");
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1c2430;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #d5dae1;border-radius:3px;">
            <tr>
              <td style="padding:28px 28px 24px;">
                <h1 style="margin:0 0 16px;font-size:20px;line-height:28px;">You're in</h1>
                <p style="margin:0 0 12px;font-size:14px;line-height:22px;">${escapeHtml(greeting)}</p>
                <p style="margin:0 0 20px;font-size:14px;line-height:22px;">Your Plan Markup account has been activated. Sign in to open your workspace.</p>
                <p style="margin:0 0 20px;">
                  <a href="${escapeHtml(signIn)}" style="display:inline-block;padding:10px 18px;background:#c2410c;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;border-radius:2px;">Sign in to Plan Markup</a>
                </p>
                <p style="margin:0;font-size:12px;line-height:18px;color:#5b6676;">If you did not create this account, you can ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { subject: YOU_ARE_IN_SUBJECT, text, html };
}

const ROLE_PHRASES = { admin: "an admin", member: "a member", viewer: "a viewer" } as const;

export function inviteSubject(companyName: string): string {
  return `Join ${companyName} on Plan Markup`;
}

/** Story 10.6: a company admin invites someone. `link` is the single-use /invite link. */
export function inviteMail({
  companyName,
  inviterName,
  role,
  link,
}: {
  companyName: string;
  inviterName: string;
  role: keyof typeof ROLE_PHRASES;
  link: string;
}): { subject: string; text: string; html: string } {
  const who = inviterName.trim() === "" ? "A colleague" : inviterName.trim();
  const line = `${who} invited you to join ${companyName} on Plan Markup as ${ROLE_PHRASES[role]}.`;
  const text = [
    "Hello,",
    "",
    line,
    "",
    "Open this link to join. It works once, for this email address only, and expires in 7 days:",
    link,
    "",
    "If you were not expecting this, you can ignore this email.",
    "",
    "Plan Markup",
  ].join("\n");
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1c2430;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #d5dae1;border-radius:3px;">
            <tr>
              <td style="padding:28px 28px 24px;">
                <h1 style="margin:0 0 16px;font-size:20px;line-height:28px;">Join ${escapeHtml(companyName)}</h1>
                <p style="margin:0 0 20px;font-size:14px;line-height:22px;">${escapeHtml(line)}</p>
                <p style="margin:0 0 20px;">
                  <a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#c2410c;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;border-radius:2px;">See the invitation</a>
                </p>
                <p style="margin:0 0 8px;font-size:12px;line-height:18px;color:#5b6676;">The link works once, for this email address only, and expires in 7 days.</p>
                <p style="margin:0;font-size:12px;line-height:18px;color:#5b6676;">If you were not expecting this, you can ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { subject: inviteSubject(companyName), text, html };
}

export const CONFIRM_SIGN_UP_SUBJECT = "Confirm your Plan Markup account";

/**
 * Security review M3: the sign-up confirmation, sent by the app (accounts are
 * made on the server only, so Auth no longer sends it). The same words as
 * supabase/templates/confirmation.html.
 */
export function confirmSignUpMail({ link }: { link: string }): { subject: string; text: string; html: string } {
  const text = [
    "Someone, hopefully you, created a Plan Markup account with this email address.",
    "",
    "Confirm your email:",
    link,
    "",
    "The link works once and expires in one hour. After you confirm, the Plan Markup administrator activates your account; you can sign in to see where it stands.",
    "",
    "If you did not sign up, ignore this email: no account is used until the address is confirmed.",
    "",
    "Plan Markup",
  ].join("\n");
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1c2430;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #d5dae1;border-radius:3px;">
            <tr>
              <td style="padding:28px 28px 24px;">
                <h1 style="margin:0 0 16px;font-size:20px;line-height:28px;">Confirm your Plan Markup account</h1>
                <p style="margin:0 0 20px;font-size:14px;line-height:22px;">Someone, hopefully you, created a Plan Markup account with this email address.</p>
                <p style="margin:0 0 20px;">
                  <a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#c2410c;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;border-radius:2px;">Confirm my email</a>
                </p>
                <p style="margin:0 0 8px;font-size:12px;line-height:18px;color:#5b6676;">The link works once and expires in one hour. After you confirm, the Plan Markup administrator activates your account; you can sign in to see where it stands.</p>
                <p style="margin:0;font-size:12px;line-height:18px;color:#5b6676;">If you did not sign up, ignore this email: no account is used until the address is confirmed.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { subject: CONFIRM_SIGN_UP_SUBJECT, text, html };
}
