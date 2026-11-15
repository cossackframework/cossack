/**
 * Turnstile on the sign-in, registration and password reset request forms, once TURNSTILE_SITE_KEY and
 * TURNSTILE_SECRET_KEY are set, as on the site's forms and comments. Pages render the widget
 * with {@link botCheckKey} and send its token (`botCheckToken` in auth-bot-token.ts, which the
 * browser loads; this module is server-only); their server actions check it with
 * {@link passesBotCheck} before anything else, so a failed check says nothing about the account.
 */
import { createTurnstileVerifier } from '@cossackframework/auth/turnstile';
import { getClientIp, getRequestContext } from '@cossackframework/core';

/** The form the token comes from: `login` covers the password and the sign-in link, one widget for both. */
export type BotCheckAction = 'login' | 'register' | 'reset';

/** The widget's site key, or null when the bot check is off. */
export function botCheckKey(): string | null {
  const siteKey = env('TURNSTILE_SITE_KEY', '');
  return siteKey && env('TURNSTILE_SECRET_KEY', '') ? siteKey : null;
}

/** Whether the token passes the check; always true while the check is off. */
export async function passesBotCheck(token: unknown, action: BotCheckAction): Promise<boolean> {
  if (!botCheckKey()) return true;
  const c = getRequestContext();
  const verifier = createTurnstileVerifier({
    secret: env('TURNSTILE_SECRET_KEY', ''),
    expectedHostname: env('TURNSTILE_HOSTNAME', '') || (c ? new URL(c.req.url).hostname : ''),
    expectedAction: action,
  });
  const ip = c ? getClientIp(c) : '';
  const verdict = await verifier.verify({ token, ...(ip && /^[a-fA-F0-9:.]{1,64}$/.test(ip) ? { remoteIP: ip } : {}) });
  return verdict.success;
}
