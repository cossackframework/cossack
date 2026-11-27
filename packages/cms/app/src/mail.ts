// The sender of the account emails, for the shared sign-in code (auth.ts): the site's mailer,
// so they go through `cms.mail.before-send`, the site's sender and, in development, the mail kept
// for `GET /api/cms/dev/mail`.
import { currentCms } from './cms/index';

export interface Mail { to: string; subject: string; text: string; kind?: 'verification' | 'reset' | 'magic-link' | 'invitation' | 'other' }

/** The site's mailer, or null when the site has no email sender. */
export function mailer(): { send(mail: Mail): Promise<void> } | null {
  let cms;
  try { cms = currentCms(); } catch { return null; }
  const mail = cms.mail;
  if (!mail) return null;
  return { async send(message) { await mail.send({ ...(message.kind ? { kind: message.kind } : {}), to: message.to, from: cms.mailFrom, subject: message.subject, text: message.text }); } };
}
