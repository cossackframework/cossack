// Login failures for unknown users and wrong passwords must cost the same, so
// response time does not reveal which accounts exist. Wall-clock timing is too
// noisy to test; the cost is the PBKDF2 key derivation, so count derivations.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createAuth, createCredentialVerifier, createPasswordHasher } from '../src/index';

const password = 'fixture-password';
afterEach(() => vi.restoreAllMocks());

interface Account { id: string; email: string; hash: string | null }

async function fixture() {
    const hasher = createPasswordHasher({ iterations: 1000 });
    const accounts = new Map<string, Account>([
        ['ada@example.com', { id: 'u1', email: 'ada@example.com', hash: await hasher.hash(password) }],
        // An account that only signs in through OAuth.
        ['oauth@example.com', { id: 'u2', email: 'oauth@example.com', hash: null }],
    ]);
    const verifier = createCredentialVerifier({
        find: async (identifier: string) => accounts.get(identifier) ?? null,
        passwordHash: account => account.hash,
        user: account => ({ id: account.id }),
        hasher,
    });
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    /** Key derivations performed by one call. */
    const derivations = async (run: () => Promise<unknown>) => {
        derive.mockClear();
        await run();
        return derive.mock.calls.length;
    };
    return { verifier, derivations };
}

describe('credential verification cost', () => {
    it.each([
        ['an unknown identifier', 'nobody@example.com', password],
        ['an account without a password hash', 'oauth@example.com', password],
        ['a wrong password', 'ada@example.com', 'wrong-password'],
        ['the right password', 'ada@example.com', password],
    ])('derives one key for %s, including the first request of a fresh verifier', async (_label, identifier, attempt) => {
        // A fresh verifier models a cold Worker isolate: its first miss must not
        // also pay for creating the dummy hash it compares against.
        const { verifier, derivations } = await fixture();
        expect(await derivations(() => verifier.verify(identifier, attempt))).toBe(1);
        expect(await derivations(() => verifier.verify(identifier, attempt))).toBe(1);
        expect(await derivations(() => verifier.verify('ada@example.com', 'wrong-password'))).toBe(1);
    });

    it('keeps concurrent first misses at no more than one derivation each', async () => {
        const { verifier, derivations } = await fixture();
        const count = await derivations(() => Promise.all(
            Array.from({ length: 5 }, (_, index) => verifier.verify(`missing-${index}@example.com`, password))));
        expect(count).toBeLessThanOrEqual(5);
        expect(await derivations(() => verifier.verify('missing@example.com', password))).toBe(1);
    });
});

describe('login handler failures', () => {
    async function login(verifier: Awaited<ReturnType<typeof fixture>>['verifier'], body: Record<string, string>) {
        const kit = createAuth<{ id: string }>({
            extractSessionId: () => undefined,
            validateSessionId: async () => null,
            resolveUserById: async () => null,
            createSession: async () => ({ headers: new Headers({ 'Set-Cookie': 'session=1; HttpOnly' }) }),
        });
        const app = new Hono();
        app.post('/login', kit.createLoginHandler({
            validateCredentials: (credentials: { email: string; password: string }) => verifier.verify(credentials.email, credentials.password),
        }));
        return app.request('http://localhost/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
    }

    it('answers an unknown user and a wrong password identically, with one derivation each', async () => {
        const { verifier, derivations } = await fixture();
        let unknown!: Response;
        let wrong!: Response;
        expect(await derivations(async () => { unknown = await login(verifier, { email: 'nobody@example.com', password }); })).toBe(1);
        expect(await derivations(async () => { wrong = await login(verifier, { email: 'ada@example.com', password: 'wrong-password' }); })).toBe(1);
        expect(unknown.status).toBe(401);
        expect(wrong.status).toBe(401);
        expect(await unknown.text()).toBe(await wrong.text());
        expect(unknown.headers.get('set-cookie')).toBeNull();
        expect(wrong.headers.get('set-cookie')).toBeNull();

        const ok = await login(verifier, { email: 'ada@example.com', password });
        expect(ok.status).toBe(200);
        expect(ok.headers.get('set-cookie')).toContain('session=1');
    });
});
