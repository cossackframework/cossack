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
        // Each begun sign-in counts; a wrong password leaves it counted.
        for (let i = 0; i < SIGN_IN_LOCK.perEmail; i++) expect(await cms.security.signInBegin(i % 2 ? 'Ada@Example.com' : 'ada@example.com', '10.0.0.1')).toEqual({ ok: true });
        const locked = await cms.security.signInBegin('ada@example.com', '10.0.0.2');
        expect(locked.ok).toBe(false);
        expect(locked.ok ? 0 : locked.retryAfterMs).toBe(SIGN_IN_LOCK.windowMs);
        // Another email from the same address is fine: the address is far from its own limit.
        expect(await cms.security.signInBegin('eve@example.com', '10.0.0.1')).toEqual({ ok: true });
        clock += 5 * 60_000;
        expect((await cms.security.signInBegin('ada@example.com', '10.0.0.1')) as { retryAfterMs?: number }).toMatchObject({ ok: false, retryAfterMs: SIGN_IN_LOCK.windowMs - 5 * 60_000 });
        await cms.security.signInSucceeded('ada@example.com', '10.0.0.1');
        expect(await cms.security.signInBegin('ada@example.com', '10.0.0.1')).toEqual({ ok: true });
    });

    it('locks an address after twenty failures across emails, until the window ends', async () => {
        for (let i = 0; i < SIGN_IN_LOCK.perAddress; i++) expect((await cms.security.signInBegin(`guess${i}@example.com`, '10.9.9.9')).ok).toBe(true);
        expect((await cms.security.signInBegin('new@example.com', '10.9.9.9')).ok).toBe(false);
        // The refused attempt does not count against the email.
        for (let i = 0; i < SIGN_IN_LOCK.perEmail; i++) expect((await cms.security.signInBegin('new@example.com', '10.9.9.8')).ok).toBe(true);
        clock += SIGN_IN_LOCK.windowMs + 1;
        expect(await cms.security.signInBegin('fresh@example.com', '10.9.9.9')).toEqual({ ok: true });
    });

    it('gives right passwords their attempt back, so an address signing in often is not locked', async () => {
        for (let i = 0; i < SIGN_IN_LOCK.perAddress * 2; i++) {
            expect((await cms.security.signInBegin(`staff${i}@example.com`, '10.5.5.5')).ok).toBe(true);
            await cms.security.signInSucceeded(`staff${i}@example.com`, '10.5.5.5');
        }
    });

    it('goes on when giving an attempt back keeps conflicting, leaving it counted', async () => {
        const db = service.database();
        const busy = new Proxy(db, {
            get(target, property) {
                if (property === 'write') return async (statements: { rql: string }[], options?: unknown) => {
                    if (statements.some(statement => /count - 1|^DELETE FROM cms_attempts WHERE key = \$key$/.test(statement.rql))) throw Object.assign(new Error('engine: Write-write conflict'), { code: 'RDB_WRITE_CONFLICT' });
                    return target.write(statements as never, options as never);
                };
                const value = Reflect.get(target, property, target) as unknown;
                return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
            },
        });
        const contended = createCMS({ db: busy, now: () => clock });
        expect((await contended.security.signInBegin('busy@example.com', '10.4.4.4')).ok).toBe(true);
        await expect(contended.security.signInSucceeded('busy@example.com', '10.4.4.4')).resolves.toBeUndefined();
        // The address refuses; giving the email's attempt back conflicts, and the refusal still answers.
        for (let i = 0; i < SIGN_IN_LOCK.perAddress; i++) await contended.security.signInBegin(`fill${i}@example.com`, '10.4.4.5');
        expect((await contended.security.signInBegin('other@example.com', '10.4.4.5')).ok).toBe(false);
    });

    it('counts attempts of a kind within a window', async () => {
        for (let i = 0; i < RESET_REQUESTS.perEmail; i++) expect(await cms.security.attempt('reset', 'e:ada@example.com', RESET_REQUESTS.perEmail, RESET_REQUESTS.windowMs)).toBe(true);
        expect(await cms.security.attempt('reset', 'e:ada@example.com', RESET_REQUESTS.perEmail, RESET_REQUESTS.windowMs)).toBe(false);
        expect(await cms.security.attempt('reset', 'e:eve@example.com', RESET_REQUESTS.perEmail, RESET_REQUESTS.windowMs)).toBe(true);
        clock += RESET_REQUESTS.windowMs + 1;
        expect(await cms.security.attempt('reset', 'e:ada@example.com', RESET_REQUESTS.perEmail, RESET_REQUESTS.windowMs)).toBe(true);
    });

    it('lets no more than the budget through when attempts arrive at once, and counts every failure', async () => {
        const results = await Promise.all(Array.from({ length: 10 }, () => cms.security.attempt('magic', 'e:burst@example.com', 5, RESET_REQUESTS.windowMs)));
        expect(results.filter(Boolean)).toHaveLength(5);
        // Fifteen guesses at once for one email: no more than its limit get to check a password.
        const begun = await Promise.all(Array.from({ length: 15 }, (_, i) => cms.security.signInBegin('burst@example.com', `10.7.7.${i}`)));
        expect(begun.filter(entry => entry.ok)).toHaveLength(SIGN_IN_LOCK.perEmail);
        expect((await cms.security.signInBegin('burst@example.com', '10.7.8.1')).ok).toBe(false);
    });
});
