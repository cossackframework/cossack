import { beforeAll, describe, expect, it } from 'vitest';
import { createCMS, RESET_REQUESTS, SIGN_IN_LOCK, type CmsHost } from '../src/server/index';
import { live, romedbService } from './helpers';

describe.skipIf(!live)('sign-in lock', () => {
    const service = romedbService();
    let clock = Date.parse('2026-11-07T12:00:00Z');
    let cms: CmsHost;

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), now: () => clock });
        expect((await cms.migrate()).failed).toBeUndefined();
    }, 30_000);

    it('locks an email after five failures, whatever the case, and forgets them on success', async () => {
        for (let i = 0; i < SIGN_IN_LOCK.perEmail; i++) {
            expect(await cms.security.signInAllowed('Ada@Example.com', '10.0.0.1')).toEqual({ ok: true });
            await cms.security.signInFailed('ada@example.com', '10.0.0.1');
        }
        const locked = await cms.security.signInAllowed('ada@example.com', '10.0.0.2');
        expect(locked.ok).toBe(false);
        expect(locked.ok ? 0 : locked.retryAfterMs).toBe(SIGN_IN_LOCK.windowMs);
        // Another email from the same address is fine: the address is far from its own limit.
        expect(await cms.security.signInAllowed('eve@example.com', '10.0.0.1')).toEqual({ ok: true });
        clock += 5 * 60_000;
        expect((await cms.security.signInAllowed('ada@example.com', '10.0.0.1')) as { retryAfterMs?: number }).toMatchObject({ ok: false, retryAfterMs: SIGN_IN_LOCK.windowMs - 5 * 60_000 });
        await cms.security.signInSucceeded('ada@example.com');
        expect(await cms.security.signInAllowed('ada@example.com', '10.0.0.1')).toEqual({ ok: true });
    });

    it('locks an address after twenty failures across emails, until the window ends', async () => {
        for (let i = 0; i < SIGN_IN_LOCK.perAddress; i++) await cms.security.signInFailed(`guess${i}@example.com`, '10.9.9.9');
        expect((await cms.security.signInAllowed('new@example.com', '10.9.9.9')).ok).toBe(false);
        expect(await cms.security.signInAllowed('new@example.com', '10.9.9.8')).toEqual({ ok: true });
        clock += SIGN_IN_LOCK.windowMs + 1;
        expect(await cms.security.signInAllowed('new@example.com', '10.9.9.9')).toEqual({ ok: true });
    });

    it('counts attempts of a kind within a window', async () => {
        for (let i = 0; i < RESET_REQUESTS.perEmail; i++) expect(await cms.security.attempt('reset', 'e:ada@example.com', RESET_REQUESTS.perEmail, RESET_REQUESTS.windowMs)).toBe(true);
        expect(await cms.security.attempt('reset', 'e:ada@example.com', RESET_REQUESTS.perEmail, RESET_REQUESTS.windowMs)).toBe(false);
        expect(await cms.security.attempt('reset', 'e:eve@example.com', RESET_REQUESTS.perEmail, RESET_REQUESTS.windowMs)).toBe(true);
        clock += RESET_REQUESTS.windowMs + 1;
        expect(await cms.security.attempt('reset', 'e:ada@example.com', RESET_REQUESTS.perEmail, RESET_REQUESTS.windowMs)).toBe(true);
    });
});
