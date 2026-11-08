import { describe, expect, it } from 'vitest';
import { CAPABILITIES, manifestProblems, requestedGrants, SYSTEM_META, UNRESTRICTED_GRANT, type CmsPluginManifest } from '../src/index';
import { pluginCapabilities, pluginMetaKey, type CapabilityHost } from '../src/server/capabilities';

const base: CmsPluginManifest = { schemaVersion: 1, name: 'desk', version: '1.0.0' };
const full: CmsPluginManifest = { ...base,
    permissions: { files: true, mail: true, jobs: true, cache: true, ai: true, payments: true, users: ['read', 'write'], secrets: ['STRIPE_SECRET_KEY'] },
    schedules: [{ name: 'digest', cron: '0 8 * * *', description: 'The morning digest.' }],
};
const problems = (manifest: unknown) => manifestProblems(manifest).join(' ');

describe('capability declarations', () => {
    it('accepts every capability and lists the grants', () => {
        expect(manifestProblems(full)).toEqual([]);
        expect(requestedGrants(full)).toEqual(['capability:ai', 'capability:cache', 'capability:files', 'capability:jobs', 'capability:mail', 'capability:payments', 'secret:STRIPE_SECRET_KEY', 'users:read', 'users:write']);
        expect(requestedGrants(base)).toEqual([]);
        expect(CAPABILITIES).toEqual(['files', 'mail', 'jobs', 'cache', 'ai', 'payments', 'unrestricted']);
    });

    it('declares unrestricted access as one grant, which covers schedules', () => {
        const unrestricted: CmsPluginManifest = { ...base, permissions: { unrestricted: true }, schedules: [{ name: 'digest', cron: '0 8 * * *' }] };
        expect(manifestProblems(unrestricted)).toEqual([]);
        expect(requestedGrants(unrestricted)).toEqual([UNRESTRICTED_GRANT]);
        expect(UNRESTRICTED_GRANT).toBe('capability:unrestricted');
        expect(problems({ ...base, permissions: { unrestricted: 'yes' } })).toMatch(/permissions.unrestricted is true or false/);
    });

    it('checks the shapes', () => {
        expect(problems({ ...base, permissions: { files: 'yes' } })).toMatch(/permissions.files is true or false/);
        expect(problems({ ...base, permissions: { users: [] } })).toMatch(/users must list read or write/);
        expect(problems({ ...base, permissions: { users: ['delete'] } })).toMatch(/users must list read or write/);
        expect(problems({ ...base, permissions: { secrets: 'STRIPE' } })).toMatch(/secrets must list/);
        expect(problems({ ...base, permissions: { secrets: ['stripe_key'] } })).toMatch(/upper-case binding name/);
        expect(problems({ ...base, permissions: { secrets: ['ROMEDB_TOKEN'] } })).toMatch(/belongs to the host/);
        expect(problems({ ...base, permissions: { secrets: ['EMAIL'] } })).toMatch(/belongs to the host/);
    });

    it('checks schedules', () => {
        expect(problems({ ...base, schedules: [{ name: 'digest', cron: '0 8 * * *' }] })).toMatch(/schedules need permissions.jobs/);
        expect(problems({ ...base, permissions: { jobs: true }, schedules: [{ name: 'Digest', cron: '0 8 * * *' }] })).toMatch(/needs a name/);
        expect(problems({ ...base, permissions: { jobs: true }, schedules: [{ name: 'a', cron: 'daily' }] })).toMatch(/cron is not a five-field/);
        expect(problems({ ...base, permissions: { jobs: true }, schedules: [{ name: 'a', cron: '0 0 30 2 *' }] })).toMatch(/never comes/);
        expect(problems({ ...base, permissions: { jobs: true }, schedules: [{ name: 'a', cron: '* * * * *' }, { name: 'a', cron: '* * * * *' }] })).toMatch(/listed twice/);
        expect(problems({ ...base, permissions: { jobs: true }, schedules: Array.from({ length: 21 }, (_, i) => ({ name: `s${i}`, cron: '* * * * *' })) })).toMatch(/at most 20/);
        expect(problems({ ...base, permissions: { jobs: true }, schedules: [{ name: 'a', cron: '* * * * *', description: 'x'.repeat(201) }] })).toMatch(/description/);
        expect(problems({ ...base, permissions: { jobs: true }, schedules: 'none' })).toMatch(/schedules\[0\] must be an object/);
    });

    it('keeps plugin meta under a system key', () => {
        expect(pluginMetaKey('support-desk')).toBe('_p_support_desk');
        expect(SYSTEM_META.test(pluginMetaKey('support-desk'))).toBe(true);
        const long = pluginMetaKey('a-very-long-plugin-name-that-goes-on-and-on-for-sixty-four-chars');
        expect(long.length).toBeLessThanOrEqual(41);
        expect(SYSTEM_META.test(long)).toBe(true);
        expect(long).not.toBe(pluginMetaKey('a-very-long-plugin-name-that-goes-on-and-on-for-sixty-four-charz'));
    });
});

describe('capabilities without a database', () => {
    const sent: unknown[] = [];
    const queued: { topic: string; event: { eventId: string }; options: unknown }[] = [];
    let allow = true;
    const host = (overrides: Partial<CapabilityHost> = {}): CapabilityHost => ({
        name: 'desk', manifest: full,
        allowed: async (grant, what) => { if (!allow) throw Object.assign(new Error(`not granted ${what}`), { code: 'CMS_FORBIDDEN', grant }); },
        files: null, mail: { send: async message => { sent.push(message); } }, mailFrom: 'site@example.com',
        users: {} as never, cache: {} as never, ai: null, payments: null,
        outbox: { enqueue: async (topic: string, event: { eventId: string }, options: unknown) => { queued.push({ topic, event, options }); return true; } } as never,
        secrets: name => ({ STRIPE_SECRET_KEY: 'sk_test' })[name], now: () => 1_000_000, queued: () => undefined,
        ...overrides,
    });

    it('sends mail as the site after validating the message', async () => {
        const { mail } = pluginCapabilities(host());
        await mail.send({ to: 'ada@example.com', subject: '  Hello ', text: 'Hi' });
        expect(sent).toEqual([{ to: 'ada@example.com', from: 'site@example.com', subject: 'Hello', text: 'Hi' }]);
        await expect(mail.send({ to: 'nobody', subject: 'x', text: 'y' })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(mail.send({ to: 'a@b.co', subject: '', text: 'y' })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(mail.send({ to: 'a@b.co', subject: 'x', text: 'y', replyTo: 'no' })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(pluginCapabilities(host({ mail: null })).mail.send({ to: 'a@b.co', subject: 'x', text: 'y' })).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        allow = false;
        await expect(mail.send({ to: 'a@b.co', subject: 'x', text: 'y' })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN', grant: 'capability:mail' });
        allow = true;
    });

    it('names job handlers once and queues jobs with their timing and key', async () => {
        const { jobs, runJob } = pluginCapabilities(host());
        const seen: unknown[] = [];
        jobs.handle('notify', (payload, context) => { seen.push([payload, context.principal.kind, context.scheduledAt]); });
        expect(() => jobs.handle('Notify', () => undefined)).toThrow(/job names/);
        expect(() => jobs.handle('notify', () => undefined)).toThrow(/twice/);
        await expect(jobs.enqueue('missing')).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        await expect(jobs.enqueue('notify', 'x'.repeat(70 * 1024))).rejects.toMatchObject({ code: 'CMS_LIMIT' });
        await expect(jobs.enqueue('notify', {}, { key: 'has space' })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(jobs.enqueue('notify', {}, { delayMs: 400 * 24 * 3_600_000 })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        expect(await jobs.enqueue('notify', { ticket: 1 }, { delayMs: 5_000, key: 'ticket-1' })).toBe(true);
        expect(queued).toHaveLength(1);
        expect(queued[0]!.topic).toBe('plugin.job');
        expect(queued[0]!.event.eventId).toBe('job:desk:notify:ticket-1');
        expect(queued[0]!.options).toEqual({ availableAt: 1_005_000, ignoreDuplicate: true });
        expect(await jobs.enqueue('notify', null)).toBe(true);
        expect(queued[1]!.options).toEqual({ availableAt: 1_000_000, ignoreDuplicate: false });
        await runJob({ eventId: 'e', topic: 'plugin.job', at: 1, plugin: 'desk', name: 'notify', payload: { ticket: 1 }, scheduledAt: 5, key: null }, {});
        expect(seen).toEqual([[{ ticket: 1 }, 'system', 5]]);
        await expect(runJob({ eventId: 'e', topic: 'plugin.job', at: 1, plugin: 'desk', name: 'other', payload: null, scheduledAt: null, key: null }, {})).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
    });

    it('serves only declared, granted secrets', async () => {
        const { secrets } = pluginCapabilities(host());
        expect(await secrets.get('STRIPE_SECRET_KEY')).toBe('sk_test');
        await expect(secrets.get('ROMEDB_TOKEN')).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        allow = false;
        await expect(secrets.get('STRIPE_SECRET_KEY')).rejects.toMatchObject({ grant: 'secret:STRIPE_SECRET_KEY' });
        allow = true;
    });

    it('serves the AI and payments providers the application has, and says when it has none', async () => {
        const none = pluginCapabilities(host());
        await expect(none.ai.complete({ prompt: 'hi' })).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        await expect(none.payments.checkout({ successUrl: 'https://s.test/a', cancelUrl: 'https://s.test/b', priceId: 'p' })).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        expect(none.payments.provider).toBeNull();
        const some = pluginCapabilities(host({ ai: { name: 'fake', complete: async request => `echo:${request.prompt}` }, payments: { name: 'fake-pay', checkout: async input => ({ id: 'c1', url: `https://pay.test/${input.reference ?? 'x'}` }), webhook: async () => null } }));
        expect(await some.ai.complete({ prompt: 'hi' })).toBe('echo:hi');
        expect(some.payments.provider).toBe('fake-pay');
        expect(await some.payments.checkout({ successUrl: 'https://s.test/a', cancelUrl: 'https://s.test/b', priceId: 'p', reference: 'o1' })).toEqual({ id: 'c1', url: 'https://pay.test/o1' });
        allow = false;
        await expect(some.ai.complete({ prompt: 'hi' })).rejects.toMatchObject({ grant: 'capability:ai' });
        await expect(some.payments.checkout({ successUrl: 'https://s.test/a', cancelUrl: 'https://s.test/b', priceId: 'p' })).rejects.toMatchObject({ grant: 'capability:payments' });
        allow = true;
    });

    it('refuses files without storage and bad cache keys', async () => {
        const { files, cache } = pluginCapabilities(host());
        await expect(files.get('x')).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        expect(files.url({ id: 'abc', name: 'logo.png' })).toMatch(/abc/);
        await expect(cache.get('has space')).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    });
});
