/// <reference types="node" />
import { pbkdf2Sync } from 'node:crypto';
import { afterEach, expect, expectTypeOf, it, vi } from 'vitest';
import { Hono, type Context } from 'hono';
import { AuthError, createPasswordHasher, hashPassword, verifyPassword, createCredentialVerifier, createSessionManager,
    type AuthSessionRecord, type AuthSessionStore } from '../src/index';

const password = 'fixture-password-🦆';
const privateValue = 'PRIVATE_PASSWORD_SESSION_DATABASE_SECRET';
afterEach(() => vi.restoreAllMocks());

async function context() {
    let result!: Context;
    const app = new Hono();
    app.get('/', c => { result = c; return new Response(null); });
    await app.request('/');
    return result;
}

function sessions() {
    let time = 1700000000000;
    const rows = new Map<string, AuthSessionRecord>();
    const store: AuthSessionStore = {
        create: vi.fn(async row => { if (rows.has(row.id)) throw new Error(privateValue); rows.set(row.id, row); }),
        read: vi.fn(async id => rows.get(id) ?? null),
        replace: vi.fn(async (expected, replacement, now) => {
            const current = rows.get(expected.id);
            if (!current || current.userId !== expected.userId || current.createdAt !== expected.createdAt ||
                current.expiresAt !== expected.expiresAt || current.expiresAt <= now || current.kind !== 'auth') return false;
            rows.delete(expected.id); rows.set(replacement.id, replacement); return true;
        }),
        revoke: vi.fn(async id => { rows.delete(id); }),
    };
    const manager = createSessionManager({ store, ttlSeconds: 10, now: () => time,
        cookie: { name: '__Host-auth-session', path: '/', secure: true } });
    return { manager, rows, store, setTime: (value: number) => { time = value; }, time: () => time };
}

it('uses random salts, preserves UTF-8 passwords and matches Node PBKDF2 independently', async () => {
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).toMatch(/^pbkdf2-sha256\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
    const [, count, salt, digest] = first.split('$');
    expect(pbkdf2Sync(password, Buffer.from(salt!, 'hex'), Number(count), 32, 'sha256').toString('hex')).toBe(digest);
    expect(await verifyPassword(password, first)).toBe(true);
    const accent = await hashPassword('café');
    expect(await verifyPassword('café', accent)).toBe(true);
    expect(await verifyPassword('café'.normalize('NFD'), accent)).toBe(false);
    expect(await verifyPassword('wrong', first)).toBe(false);
});

it.each(['', 'pbkdf2$00$00', 'pbkdf2-sha256$0', 'pbkdf2-sha256$100001', 'pbkdf2-sha256$01', 'pbkdf2-sha256$Infinity',
    'pbkdf2-sha256$1.5', 'pbkdf2-sha256$-1', 'pbkdf2-sha256$10000000'])('rejects malformed or excessive hash %s before crypto', async prefix => {
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    expect(await verifyPassword(password, `${prefix}$${'00'.repeat(16)}$${'00'.repeat(32)}`)).toBe(false);
    expect(derive).not.toHaveBeenCalled();
});

it.each(['x', 'a'.repeat(31), 'a'.repeat(33), 'A'.repeat(32), 'gg'.repeat(16)])('rejects a noncanonical salt %s before crypto', async salt => {
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    expect(await verifyPassword(password, `pbkdf2-sha256$100000$${salt}$${'00'.repeat(32)}`)).toBe(false);
    expect(derive).not.toHaveBeenCalled();
});

it.each(['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'gg'.repeat(32), `${'00'.repeat(32)}$extra`])('rejects a noncanonical digest before crypto (%s)', async digest => {
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    expect(await verifyPassword(password, `pbkdf2-sha256$100000$${'00'.repeat(16)}$${digest}`)).toBe(false);
    expect(derive).not.toHaveBeenCalled();
});

it('does not truncate, normalize or derive overlong input', async () => {
    const hasher = createPasswordHasher({ maxPasswordBytes: 4 });
    const encoded = await hasher.hash('éé');
    expect(await hasher.verify('éé', encoded)).toBe(true);
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    await expect(hasher.hash('ééa')).rejects.toMatchObject({ code: 'COSSACK_AUTH_PASSWORD_INVALID' });
    expect(await hasher.verify('ééa', encoded)).toBe(false);
    expect(await hasher.verify('', encoded)).toBe(false);
    expect(derive).not.toHaveBeenCalled();
});

it.each([{ iterations: 0 }, { iterations: NaN }, { iterations: 1.5 }, { iterations: 100001, maxIterations: 100000 },
    { maxIterations: 10000001 }, { maxPasswordBytes: 0 }, { maxPasswordBytes: Infinity }])('rejects invalid password configuration %j', options => {
    expect(() => createPasswordHasher(options)).toThrowError(new AuthError('COSSACK_AUTH_CONFIGURATION_INVALID'));
});

it('never downgrades a stronger accepted hash and identifies lower costs for upgrade', async () => {
    const hasher = createPasswordHasher({ iterations: 100000, maxIterations: 120000 });
    expect(hasher.needsRehash!(`pbkdf2-sha256$120000$${'00'.repeat(16)}$${'00'.repeat(32)}`)).toBe(false);
    expect(hasher.needsRehash!(`pbkdf2-sha256$100000$${'00'.repeat(16)}$${'00'.repeat(32)}`)).toBe(false);
    expect(hasher.needsRehash!(`pbkdf2-sha256$50000$${'00'.repeat(16)}$${'00'.repeat(32)}`)).toBe(true);
});

it('discards crypto exceptions from password diagnostics', async () => {
    const encoded = await hashPassword(password);
    vi.spyOn(crypto.subtle, 'deriveBits').mockRejectedValue(new Error(privateValue));
    for (const [operation, code] of [[() => hashPassword(password), 'COSSACK_AUTH_PASSWORD_HASH_FAILED'],
        [() => verifyPassword(password, encoded), 'COSSACK_AUTH_PASSWORD_VERIFY_FAILED']] as const) {
        const failure = await operation().catch(error => error);
        expect(failure).toBeInstanceOf(AuthError);
        expect(failure.code).toBe(code);
        expect(failure.cause).toBeUndefined();
        expect(JSON.stringify(failure)).not.toContain(privateValue);
        expect(failure.stack).not.toContain(privateValue);
    }
});

it('infers credential records and maps only verified accounts to a safe user', async () => {
    const hash = await hashPassword(password);
    const account = { id: 'fixture-user', hash, private: privateValue };
    const user = vi.fn((record: typeof account) => ({ id: record.id }));
    const verifier = createCredentialVerifier({ find: async identifier => identifier === 'fixture' ? account : null,
        passwordHash: record => record.hash, user });
    expectTypeOf(verifier.verify).returns.toEqualTypeOf<Promise<{ id: string } | null>>();
    expect(await verifier.verify('unknown', password)).toBeNull();
    expect(await verifier.verify('fixture', 'wrong')).toBeNull();
    expect(user).not.toHaveBeenCalled();
    expect(await verifier.verify('fixture', password)).toEqual({ id: 'fixture-user' });
    expect(user).toHaveBeenCalledOnce();
});

it.each([
    ['an unknown identifier', async () => null],
    ['an account without a password hash', async () => ({ id: 'fixture-user', hash: null })],
])('runs a dummy hash verification for %s so timing matches a wrong password', async (_label, find) => {
    const real = createPasswordHasher({ iterations: 1000 });
    const hasher = { hash: vi.fn(real.hash), verify: vi.fn(real.verify) };
    const account = { id: 'fixture-user', hash: await real.hash(password) as string | null };
    const user = vi.fn((record: typeof account) => ({ id: record.id }));
    const verifier = createCredentialVerifier({ find: find as () => Promise<typeof account | null>,
        passwordHash: record => record.hash, user, hasher });
    const wrong = createCredentialVerifier({ find: async () => account, passwordHash: record => record.hash, user, hasher });

    const missResult = await verifier.verify('missing', password);
    expect(hasher.verify).toHaveBeenCalledOnce();
    // The dummy hash comes from the same hasher, so the work factor matches.
    const dummy = hasher.verify.mock.calls[0]![1];
    expect(dummy).toMatch(/^pbkdf2-sha256\$1000\$/);
    expect(hasher.hash).toHaveBeenCalledOnce();

    hasher.verify.mockClear();
    const wrongResult = await wrong.verify('fixture', 'wrong-password');
    expect(hasher.verify).toHaveBeenCalledOnce();
    expect(missResult).toBe(wrongResult);
    expect(missResult).toBeNull();
    expect(user).not.toHaveBeenCalled();

    // The dummy hash is computed lazily once and reused.
    hasher.verify.mockClear();
    expect(await verifier.verify('missing', password)).toBeNull();
    expect(hasher.verify).toHaveBeenCalledOnce();
    expect(hasher.verify.mock.calls[0]![1]).toBe(dummy);
    expect(hasher.hash).toHaveBeenCalledOnce();
});

it('never accepts a miss even when a custom hasher accepts the dummy hash', async () => {
    const hasher = { hash: vi.fn(async () => 'dummy'), verify: vi.fn(async () => true) };
    const user = vi.fn(() => ({ id: 'fixture-user' }));
    const verifier = createCredentialVerifier({ find: async () => null, passwordHash: () => 'stored', user, hasher });
    expect(await verifier.verify('missing', password)).toBeNull();
    expect(hasher.verify).toHaveBeenCalledWith(password, 'dummy');
    expect(user).not.toHaveBeenCalled();
});

it('returns the same failure when dummy hash work fails', async () => {
    const hasher = { hash: vi.fn(async () => { throw new Error(privateValue); }), verify: vi.fn(async () => false) };
    const verifier = createCredentialVerifier({ find: async () => null, passwordHash: () => 'stored', user: () => ({}), hasher });
    expect(await verifier.verify('missing', password)).toBeNull();
    // A failed dummy hash is not cached; the next miss retries it.
    expect(await verifier.verify('missing', password)).toBeNull();
    expect(hasher.hash).toHaveBeenCalledTimes(2);
});

it.each([true, false])('upgrades a verified lower-cost hash through a conditional write (wins=%s)', async wins => {
    const old = await createPasswordHasher({ iterations: 50000 }).hash(password);
    const account = { id: 'fixture-user', hash: old };
    const replace = vi.fn(async (_record, expected, replacement) => {
        expect(expected).toBe(old);
        expect(await verifyPassword(password, replacement)).toBe(true);
        if (wins) account.hash = replacement;
        return wins;
    });
    const user = vi.fn((record: typeof account) => ({ id: record.id }));
    const verifier = createCredentialVerifier({ find: async () => account, passwordHash: record => record.hash,
        user, replacePasswordHash: replace });
    expect(await verifier.verify('fixture', password)).toEqual(wins ? { id: 'fixture-user' } : null);
    expect(replace).toHaveBeenCalledOnce();
    expect(user).toHaveBeenCalledTimes(wins ? 1 : 0);
});

it.each(['find', 'passwordHash', 'user', 'replacePasswordHash'] as const)('redacts application credential %s exceptions', async stage => {
    const hasher = { hash: async () => 'replacement', verify: async () => true, needsRehash: () => true };
    const verifier = createCredentialVerifier({ find: async () => ({ id: 'fixture' }), passwordHash: () => 'stored',
        user: record => record.id, replacePasswordHash: async () => true, hasher,
        [stage]: () => { throw new Error(privateValue); } });
    const failure = await verifier.verify('fixture', password).catch(error => error);
    expect(failure).toBeInstanceOf(AuthError);
    expect(JSON.stringify(failure)).not.toContain(privateValue);
    expect(failure.cause).toBeUndefined();
});

it('rejects a custom hasher result that is truthy but is not boolean true', async () => {
    const user = vi.fn(() => ({ id: 'fixture-user' }));
    const verifier = createCredentialVerifier({ find: async () => ({ hash: 'stored' }), passwordHash: record => record.hash,
        user, hasher: { hash: async () => 'stored', verify: async () => 'yes' as unknown as boolean } });
    expect(await verifier.verify('fixture', password)).toBeNull();
    expect(user).not.toHaveBeenCalled();
});

it('issues frozen opaque session records and validates exact expiry without refreshing them', async () => {
    const c = await context(); const { manager, rows, store, setTime, time } = sessions();
    const issued = await manager.create('fixture-user', c);
    expect(issued.session.id).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(issued.session)).toBe(true);
    expect(issued.headers.get('set-cookie')).toMatch(/__Host-auth-session=.*; Max-Age=10; Path=\/; HttpOnly; Secure; SameSite=Lax/);
    expect(await manager.validate(issued.session.id, c)).toEqual(issued.session);
    setTime(time() + 9999);
    expect(await manager.validate(issued.session.id, c)).toEqual(issued.session);
    expect(store.create).toHaveBeenCalledOnce();
    setTime(time() + 1);
    expect(await manager.validate(issued.session.id, c)).toBeNull();
    expect(await manager.rotate(issued.session.id, c)).toBeNull();
    expect(rows.size).toBe(1);
    expect(store.replace).not.toHaveBeenCalled();
});

it('rotates through one atomic winner and invalidates the old token without duplicate sessions', async () => {
    const c = await context(); const { manager, rows, store } = sessions();
    const original = await manager.create('fixture-user', c);
    const outcomes = await Promise.all([manager.rotate(original.session.id, c), manager.rotate(original.session.id, c)]);
    const winners = outcomes.filter(value => value !== null);
    expect(winners).toHaveLength(1);
    expect(rows.size).toBe(1);
    expect(store.replace).toHaveBeenCalledTimes(2);
    expect(await manager.validate(original.session.id, c)).toBeNull();
    expect(await manager.validate(winners[0]!.session.id, c)).toEqual(winners[0]!.session);
    expect(winners[0]!.headers.get('set-cookie')).toContain(winners[0]!.session.id);
    await manager.revoke(winners[0]!.session.id, c);
    expect(await manager.validate(winners[0]!.session.id, c)).toBeNull();
});

it.each([{ kind: 'password_reset' }, { id: 'other' }, { userId: null }, { expiresAt: NaN },
    { createdAt: NaN }, { createdAt: -1 }, { expiresAt: 0 }, { createdAt: Infinity }])('rejects invalid stored session fields %j', async patch => {
    const c = await context(); const { manager, rows } = sessions();
    const issued = await manager.create('fixture-user', c);
    rows.set(issued.session.id, { ...issued.session, ...patch } as AuthSessionRecord);
    expect(await manager.validate(issued.session.id, c)).toBeNull();
    expect(await manager.rotate(issued.session.id, c)).toBeNull();
});

it.each([{ ttlSeconds: 0 }, { ttlSeconds: Infinity }, { cookie: { secure: false, sameSite: 'None' as const } },
    { cookie: { name: '__Host-auth', domain: 'example.test' } }, { cookie: { path: '/;bad' } },
    { cookie: { domain: 'example.test\r\nInjected: private' } }])('rejects unsafe session configuration %j before storage', options => {
    const { store } = sessions();
    expect(() => createSessionManager({ store, ...options })).toThrowError(new AuthError('COSSACK_AUTH_CONFIGURATION_INVALID'));
    expect(store.create).not.toHaveBeenCalled();
});

it('uses the matching cookie path/domain to revoke and skips storage for malformed tokens', async () => {
    const c = await context(); const { store } = sessions();
    const manager = createSessionManager({ store, cookie: { name: 'custom', path: '/account', domain: 'example.test' } });
    expect(await manager.validate('bad;token', c)).toBeNull();
    expect(await manager.rotate('bad;token', c)).toBeNull();
    expect((await manager.revoke('bad;token', c)).get('set-cookie')).toMatch(/custom=; Max-Age=0; Domain=example.test; Path=\/account; HttpOnly; Secure; SameSite=Lax/);
    expect(store.read).not.toHaveBeenCalled(); expect(store.revoke).not.toHaveBeenCalled();
});

it.each(['create', 'read', 'replace', 'revoke'] as const)('redacts session %s storage failures', async stage => {
    const c = await context(); const { manager, store } = sessions();
    const issued = await manager.create('fixture-user', c);
    vi.spyOn(store, stage).mockRejectedValue(new Error(privateValue));
    const failure = await (stage === 'create' ? manager.create('fixture-user', c) : stage === 'read' ? manager.validate(issued.session.id, c)
        : stage === 'replace' ? manager.rotate(issued.session.id, c) : manager.revoke(issued.session.id, c)).catch(error => error);
    expect(failure).toBeInstanceOf(AuthError);
    expect(JSON.stringify(failure)).not.toContain(privateValue);
    expect(failure.cause).toBeUndefined();
});

it('never issues a cookie for a session that expires while storage completes', async () => {
    const c = await context(); const fixture = sessions();
    vi.spyOn(fixture.store, 'create').mockImplementation(async row => { fixture.rows.set(row.id, row); fixture.setTime(row.expiresAt); });
    await expect(fixture.manager.create('fixture-user', c)).rejects.toMatchObject({ code: 'COSSACK_AUTH_SESSION_CREATE_FAILED' });
});

it('rechecks expiry after an asynchronous storage read', async () => {
    const c = await context(); const fixture = sessions();
    const issued = await fixture.manager.create('fixture-user', c);
    vi.spyOn(fixture.store, 'read').mockImplementation(async id => {
        fixture.setTime(issued.session.expiresAt);
        return fixture.rows.get(id) ?? null;
    });
    expect(await fixture.manager.validate(issued.session.id, c)).toBeNull();
    expect(await fixture.manager.rotate(issued.session.id, c)).toBeNull();
    expect(fixture.store.replace).not.toHaveBeenCalled();
});

it('does not issue a rotated cookie after the replacement expires during storage completion', async () => {
    const c = await context(); const fixture = sessions();
    const issued = await fixture.manager.create('fixture-user', c);
    vi.spyOn(fixture.store, 'replace').mockImplementation(async (expected, replacement) => {
        fixture.rows.delete(expected.id); fixture.rows.set(replacement.id, replacement);
        fixture.setTime(replacement.expiresAt); return true;
    });
    await expect(fixture.manager.rotate(issued.session.id, c)).rejects.toMatchObject({ code: 'COSSACK_AUTH_SESSION_ROTATE_FAILED' });
    expect(await fixture.manager.validate(issued.session.id, c)).toBeNull();
});
