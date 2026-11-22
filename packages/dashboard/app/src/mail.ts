// The sender of the account emails: confirmations, sign-in links, resets, invitations. A
// package that serves these pages with its own sender (the CMS, with the site's mailer)
// replaces this module.

export interface Mail { to: string; subject: string; text: string }

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/** The email sender: the `EMAIL` binding (send_email on Workers), from `MAIL_FROM`. Null when none is configured. */
export function mailer(): { send(mail: Mail): Promise<void> } | null {
  const sender = binding<{ send: (message: unknown) => Promise<unknown> }>('EMAIL');
  if (!sender) return null;
  const from = env('MAIL_FROM', 'no-reply@example.com');
  return { async send(mail) { await sender.send({ ...mail, from, html: `<p>${escapeHtml(mail.text).replace(/\n/g, '<br>')}</p>` }); } };
}
