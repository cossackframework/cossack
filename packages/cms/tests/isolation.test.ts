import { beforeAll, describe, expect, it } from 'vitest';
import { afterCommit, beforeWrite, DEFAULT_ROLES, PERMISSIONS, userPrincipal, type CmsPluginManifest } from '../src/index';
import { createCMS, systemPrincipal, type CmsHost, type PluginContext } from '../src/server/index';
import { live, romedbService } from './helpers';
import { inProcessRunner, isolatedRegistration } from './isolation-runner';

const admin = systemPrincipal('isolation tests');
const owner = userPrincipal('owner', ['administrator'], [PERMISSIONS.dashboard, PERMISSIONS.managePlugins]);

/** An isolated plugin: everything it does goes through stand-ins, the runner and the bridge. */
const desk: CmsPluginManifest = {
    schemaVersion: 1, name: 'desk', version: '1.0.0',
    resources: [{ name: 'tickets', fields: { subject: { kind: 'string', required: true, max: 120 }, status: { kind: 'string', max: 20 } } }],
    hooks: [{ point: 'cms.resource.before-write', version: 1, priority: 5 }, { point: 'cms.resource.after-commit', version: 1 }],
    commands: [{ name: 'close-all', description: 'Close every open ticket.' }],
    permissions: { jobs: true },
} as CmsPluginManifest;
/** An application plugin on the same point, to show where the isolated one's handlers run. */
const audit: CmsPluginManifest = { schemaVersion: 1, name: 'audit', version: '1.0.0', hooks: [{ point: 'cms.resource.before-write', version: 1 }] };

describe.skipIf(!live)('isolated plugins in the host', () => {
    const service = romedbService();
    const ran: unknown[] = [];
    let cms: CmsHost;
    const deskModule = {
        register(context: PluginContext) {
            context.hooks.addFilter(beforeWrite, draft => draft.subject === undefined ? draft : { ...draft, subject: `${String(draft.subject)}!` });
            context.hooks.addAction(afterCommit, async event => {
                if (event.resource === 'desk/tickets' && event.topic === 'resource.created') await context.jobs.enqueue('notify', { id: event.id });
            });
            context.jobs.handle('notify', (payload, { principal }) => { ran.push({ payload, principal }); });
            context.commands.add('close-all', async (_input, { principal }) => {
                const tickets = context.cms.resource('desk/tickets');
                // The plugin's own principal works on its own resources.
                const own = { principal: systemPrincipal('plugin:desk') };
                const page = await tickets.list({ limit: 50 } as never, own);
                for (const ticket of page.records) await tickets.update(ticket.id, { status: 'closed' }, { ...own, expectedRevision: ticket.rev } as never);
                // The principal it was given is accepted too; the owner may not read tickets.
                const given = await tickets.list({ limit: 1 } as never, { principal }).then(() => 'allowed', (error: { code?: string }) => error.code);
                // Acting as someone it was not given is refused by the bridge.
                const forged = userPrincipal('forged', ['administrator'], [PERMISSIONS.dashboard]);
                const refused = await tickets.list({ limit: 1 } as never, { principal: forged }).then(() => 'allowed', (error: { code?: string }) => error.code);
                return { closed: page.records.length, given, forged: refused };
            });
        },
    };
    const { runner, calls } = inProcessRunner({ desk: { module: deskModule, manifest: desk } }, () => cms);

    beforeAll(async () => {
        cms = createCMS({
            db: service.database(), runner,
            plugins: [isolatedRegistration(desk), { name: 'audit', version: '1.0.0', manifest: audit, module: { register(context: PluginContext) { context.hooks.addFilter(beforeWrite, draft => draft.subject === undefined ? draft : { ...draft, subject: `${String(draft.subject)}?` }); } } }],
        });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready();
        for (const role of DEFAULT_ROLES) await cms.users.defineRole(role);
    }, 30_000);

    it('stays inactive until granted: no handler runs and the bridge refuses', async () => {
        expect(await cms.pluginActive('desk')).toBe(false);
        const plugins = (await cms.status()).plugins;
        expect(plugins.find(plugin => plugin.name === 'desk')).toMatchObject({ runtime: 'isolated' });
        expect(plugins.find(plugin => plugin.name === 'audit')).toMatchObject({ runtime: 'app' });
        await expect(cms.runCommand('desk', 'close-all', {}, { principal: owner })).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        await expect(cms.isolatedCall('desk', 'jobs.enqueue', ['notify', null, {}], [])).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        expect(calls).toEqual([]);
    });

    it('runs its filter at the manifest\'s priority, before an application plugin\'s', async () => {
        await cms.grantPlugin('desk', admin);
        await cms.grantPlugin('audit', admin);
        const created = await cms.resource('desk/tickets').create({ subject: 'Printer jam' }, { principal: admin });
        expect(created.subject).toBe('Printer jam!?');
        expect(calls.at(-1)).toMatchObject({ plugin: 'desk', work: 'hook', call: { site: 'main', run: { kind: 'filter', point: 'cms.resource.before-write' } }, props: { site: 'main', plugin: 'desk', principals: [] } });
    });

    it('runs its after-commit action from the outbox, and the job it queues, in its Worker', async () => {
        const created = await cms.resource('desk/tickets').create({ subject: 'Toner' }, { principal: admin });
        await cms.outbox.dispatch({ limit: 20 });
        await cms.outbox.dispatch({ limit: 20 });
        expect(ran).toContainEqual({ payload: { id: created.id }, principal: { kind: 'system', reason: 'plugin:desk' } });
        expect(calls.some(entry => entry.call.run.kind === 'job' && entry.work === 'work')).toBe(true);
    });

    it('runs commands as the principal given, and refuses any other', async () => {
        // The given principal reaches the repository, which applies its access rules; a forged one never does.
        expect(await cms.runCommand('desk', 'close-all', {}, { principal: owner })).toEqual({ closed: 2, given: 'CMS_FORBIDDEN', forged: 'CMS_FORBIDDEN' });
        const closed = await cms.resource('desk/tickets').list({ limit: 10 } as never, { principal: admin });
        expect(closed.records.map(record => (record as { status?: string }).status)).toEqual(['closed', 'closed']);
        expect(calls.find(entry => entry.call.run.kind === 'command')).toMatchObject({ work: 'work', props: { principals: [owner] } });
    });

    it('serves only the members isolated plugins have', async () => {
        await expect(cms.isolatedCall('desk', 'unrestricted', [], [])).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(cms.isolatedCall('desk', 'resource.list', ['desk/tickets', {}], [])).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(cms.isolatedCall('audit', 'settings.all', [], [])).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        await expect(cms.isolatedCall('desk', 'fetch', ['https://example.com'], [])).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    });

    it('stays off without a runner, never in the application', async () => {
        const bare = createCMS({ db: service.database(), plugins: [isolatedRegistration(desk)] });
        await bare.ready();
        const status = (await bare.status()).plugins.find(plugin => plugin.name === 'desk')!;
        expect(status.reason).toContain('no Worker Loader binding (LOADER)');
        expect(status.active).toBe(false);
    });

    it('names data that cannot be copied into the Worker', async () => {
        const failing = createCMS({
            db: service.database(), plugins: [isolatedRegistration(desk)],
            runner: { run: async () => { throw Object.assign(new Error('function could not be cloned.'), { name: 'DataCloneError' }); } },
        });
        await failing.ready();
        await failing.grantPlugin('desk', admin);
        await expect(failing.runCommand('desk', 'close-all', {}, { principal: owner })).rejects.toMatchObject({ code: 'COSSACK_PLUGIN_PAYLOAD', message: expect.stringContaining('cannot be copied into the plugin\'s Worker') });
    });
});
