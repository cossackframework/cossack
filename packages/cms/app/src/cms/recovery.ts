/**
 * Recovery mode: a way back in for an administrator who forgot the password on a site that
 * cannot send email. It is on while `CMS_RECOVERY_CODE` is set in the environment, so only
 * whoever controls the deployment can use it; `cossack cms password reset` sends the code with
 * an email and prints the one-hour reset link this answers with. The new password is chosen in
 * the browser, as with Forgot password, so it never passes through the command line.
 */
import type { Context } from 'hono';
import { getClientIp } from '@cossackframework/core';
import { sha256Hex, timingSafeEqual, type CmsHost } from '@cossackframework/cms/server';
import type { CmsBindings } from './index';
import { siteOrigin } from './seo';

/** Five tries per address in fifteen minutes. */
export const RECOVERY_ATTEMPTS = Object.freeze({ max: 5, windowMs: 15 * 60_000 });
/** Shorter codes are refused, so recovery cannot be switched on with a guessable one. */
export const RECOVERY_CODE_MIN_LENGTH = 16;

export class RecoveryError extends Error {
    constructor(readonly code: 'CMS_RECOVERY_OFF' | 'CMS_RECOVERY_WEAK' | 'CMS_UNAUTHENTICATED' | 'CMS_RATE_LIMITED' | 'CMS_NOT_FOUND' | 'CMS_VALIDATION', message: string, readonly status: 400 | 401 | 403 | 404 | 429) {
        super(message);
    }
}

/** The recovery code the environment holds, or null while recovery mode is off. */
export function recoveryCode(env: unknown): string | null {
    const code = (env as { CMS_RECOVERY_CODE?: unknown } | undefined)?.CMS_RECOVERY_CODE;
    return typeof code === 'string' && code.trim() ? code.trim() : null;
}

export interface RecoveryResult {
    readonly email: string;
    /** Open it within the hour to choose a new password. */
    readonly resetUrl: string;
    readonly expiresAt: number;
    /** The authenticator app, recovery codes and passkeys were removed too. */
    readonly secondFactorsCleared: boolean;
}

/**
 * Check the code and make a reset link for an active account of this site (or its network
 * account), optionally clearing its second factors. Every use is written to Tools → Activity,
 * and the account is told by email when the site can send one.
 */
export async function recoverAccount(c: Context, input: { code: unknown; email: unknown; secondFactors?: unknown }): Promise<RecoveryResult> {
    const expected = recoveryCode(c.env);
    if (!expected) throw new RecoveryError('CMS_RECOVERY_OFF', 'Recovery mode is off: set CMS_RECOVERY_CODE in the environment to turn it on.', 403);
    if (expected.length < RECOVERY_CODE_MIN_LENGTH) throw new RecoveryError('CMS_RECOVERY_WEAK', `CMS_RECOVERY_CODE must be at least ${RECOVERY_CODE_MIN_LENGTH} characters.`, 403);
    const host: CmsHost = c.get('cms');
    const address = getClientIp(c) || 'unknown';
    if (!(await host.security.attempt('recovery', `a:${address}`, RECOVERY_ATTEMPTS.max, RECOVERY_ATTEMPTS.windowMs)))
        throw new RecoveryError('CMS_RATE_LIMITED', 'Too many recovery attempts. Wait fifteen minutes.', 429);
    // Compared as digests, so the time taken says nothing about the code's length either.
    if (typeof input.code !== 'string' || !timingSafeEqual(await sha256Hex(input.code), await sha256Hex(expected))) throw new RecoveryError('CMS_UNAUTHENTICATED', 'The recovery code is not correct.', 401);
    const email = typeof input.email === 'string' ? input.email.trim() : '';
    if (!email || email.length > 254 || !email.includes('@')) throw new RecoveryError('CMS_VALIDATION', 'Give the email address of the account.', 400);

    // A site account resets on its site; a network account on the network host, as Forgot password does.
    let reset = await host.signIn.accounts.createPasswordReset(email);
    let origin = siteOrigin(c);
    if (!reset && host.siteAccounts && (await host.users.findByEmail(email).catch(() => null))?.account === 'network') {
        reset = await host.accounts.createPasswordReset(email);
        origin = (c.env as CmsBindings).APP_URL?.replace(/\/+$/, '') || siteOrigin(c);
    }
    if (!reset) throw new RecoveryError('CMS_NOT_FOUND', `No active account with the email ${email} on this site.`, 404);
    const userId = reset.account.id;
    const secondFactorsCleared = input.secondFactors === true;
    if (secondFactorsCleared) await (await host.storesOf(userId)).security.reset(userId);
    await host.audit.record({ actor: 'system:recovery', action: secondFactorsCleared ? 'recover-account-factors' : 'recover-account', resource: 'cms/users', recordId: userId }).catch(error => console.error('[cms] could not log a recovery', error));
    await host.mail?.send({ kind: 'other', to: reset.account.email, subject: 'Your account was recovered',
        text: `Someone with the site's recovery code asked for a password reset link for your account${secondFactorsCleared ? ' and removed its two-step sign-in' : ''}, from ${address}.\n\nIf that was not you or another administrator, tell whoever runs the site: the recovery code should be removed from its environment.` })
        .catch(error => console.error('[cms] could not send the recovery notice', error));
    return { email: reset.account.email, resetUrl: `${origin.replace(/\/$/, '')}/auth/reset-password?token=${reset.token}`, expiresAt: Date.now() + 60 * 60_000, secondFactorsCleared };
}
