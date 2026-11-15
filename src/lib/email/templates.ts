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
