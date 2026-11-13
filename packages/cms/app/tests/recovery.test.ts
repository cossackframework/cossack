import { describe, expect, it } from 'vitest';
import { recoverAccount, recoveryCode, RecoveryError, RECOVERY_CODE_MIN_LENGTH } from '../src/cms/recovery';

/** Only the environment and the host's rate limit matter before the code is checked. */
function context(env: Record<string, unknown>, attempts = { allowed: true }, extra: Record<string, unknown> = {}) {
    const host = { security: { attempt: async () => attempts.allowed }, ...extra };
    return { env, get: (name: string) => name === 'cms' ? host : name === 'site' ? { id: 'main', host: null } : undefined, req: { header: () => undefined, raw: new Request('http://cms.test/api/cms/recovery') } } as never;
}

const refusal = (promise: Promise<unknown>) => promise.then(() => { throw new Error('expected a refusal'); }, (error: unknown) => {
    expect(error).toBeInstanceOf(RecoveryError);
    return { code: (error as RecoveryError).code, status: (error as RecoveryError).status };
});

describe('recovery mode', () => {
    it('is off without CMS_RECOVERY_CODE, and refuses a short code', async () => {
        expect(recoveryCode({})).toBeNull();
        expect(recoveryCode({ CMS_RECOVERY_CODE: '  ' })).toBeNull();
        expect(await refusal(recoverAccount(context({}), { code: 'x', email: 'a@b.c' }))).toEqual({ code: 'CMS_RECOVERY_OFF', status: 403 });
        expect(await refusal(recoverAccount(context({ CMS_RECOVERY_CODE: 'short' }), { code: 'short', email: 'a@b.c' }))).toEqual({ code: 'CMS_RECOVERY_WEAK', status: 403 });
    });

    it('refuses a wrong code, and any code once the address used its tries', async () => {
        const code = 'r'.repeat(RECOVERY_CODE_MIN_LENGTH);
        expect(await refusal(recoverAccount(context({ CMS_RECOVERY_CODE: code }), { code: 'wrong', email: 'a@b.c' }))).toEqual({ code: 'CMS_UNAUTHENTICATED', status: 401 });
        expect(await refusal(recoverAccount(context({ CMS_RECOVERY_CODE: code }, { allowed: false }), { code, email: 'a@b.c' }))).toEqual({ code: 'CMS_RATE_LIMITED', status: 429 });
        expect(await refusal(recoverAccount(context({ CMS_RECOVERY_CODE: code }), { code, email: 'not an email' }))).toEqual({ code: 'CMS_VALIDATION', status: 400 });
    });

    it('makes no reset link when the recovery cannot be recorded', async () => {
        const code = 'r'.repeat(RECOVERY_CODE_MIN_LENGTH);
        let resets = 0;
        const host = {
            users: { findByEmail: async () => ({ id: 'u1', account: 'site' }) },
            audit: { record: async () => { throw new Error('database down'); } },
            signIn: { accounts: { createPasswordReset: async () => { resets++; return null; } } },
        };
        expect(await refusal(recoverAccount(context({ CMS_RECOVERY_CODE: code }, { allowed: true }, host), { code, email: 'a@b.c' }))).toEqual({ code: 'CMS_UNAVAILABLE', status: 503 });
        expect(resets).toBe(0);
    });
});
