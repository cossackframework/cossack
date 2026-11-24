import { beforeAll, describe, expect, it } from 'vitest';
import { createCMS, systemPrincipal, userPrincipal, type CmsHost, type PluginContext } from '../src/server/index';
import { beforeWrite, field } from '../src/index';
import { live, romedbService } from './helpers';

const system = systemPrincipal('batch tests');
const ada = userPrincipal('ada', ['staff'], ['cms:dashboard']);

/** A shift plugin: shifts with a capacity, registrations for them, and tasks. */
const manifest = {
    schemaVersion: 1, name: 'roster', version: '1.0.0',
    resources: [
        { name: 'shifts', fields: { title: field.string({ required: true }), capacity: field.integer({ required: true, min: 1 }), approved: field.integer({ default: 0 }) }, access: { read: 'authenticated', update: 'authenticated' } },
        { name: 'registrations', ownership: true, fields: { shift: field.reference('roster/shifts', { required: true, index: true }), status: field.enum(['pending', 'approved'], { required: true, default: 'pending', index: true }), note: field.string() },
            access: { read: 'authenticated', create: 'authenticated', update: 'authenticated' } },
        { name: 'audit', fields: { note: field.string() }, access: { read: 'none', create: 'none' } },
    ],
    hooks: [{ point: 'cms.resource.before-write', version: 1 }],
};

describe.skipIf(!live)('write batches', () => {
    const service = romedbService();
    let cms: CmsHost;
    let context: PluginContext;

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), plugins: [{ name: 'roster', version: '1.0.0', manifest, module: { register(value: PluginContext) {
            context = value;
            // Someone else saves the shift while the batch is being prepared.
            value.hooks.addFilter(beforeWrite, async draft => {
                if (draft.note !== 'race') return draft;
                const current = (await value.cms.resource('roster/shifts').get('m', { principal: system }))!;
                await value.cms.resource('roster/shifts').update('m', { title: 'Renamed meanwhile' }, { principal: system, expectedRevision: current.rev });
                return draft;
            });
        } } }] });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready();
        await cms.grantPlugin('roster', system);
        await cms.resource('roster/shifts').create({ title: 'Morning', capacity: 2 }, { principal: system, id: 'm' });
        for (const id of ['r1', 'r2', 'r3']) await cms.resource('roster/registrations').create({ shift: 'm' }, { principal: system, id });
    }, 30_000);

    const shift = async () => (await cms.resource('roster/shifts').get('m', { principal: system }))!;
    const registration = async (id: string) => (await cms.resource('roster/registrations').get(id, { principal: system }))!;
    const approve = async (id: string) => {
        const [current, record] = [await shift(), await registration(id)];
        return context.cms.batch([
            { update: 'roster/registrations', id, patch: { status: 'approved' }, expectedRevision: record.rev },
            { update: 'roster/shifts', id: 'm', patch: { approved: Number(current.approved) + 1 }, expectedRevision: current.rev },
        ], { principal: ada, guards: [
            // Only while fewer than the capacity are approved, and only if the registration is still pending.
            { name: 'capacity', resource: 'roster/registrations', where: { shift: 'm', status: 'approved' }, count: { max: Number(current.capacity) - 1 } },
            { name: 'pending', resource: 'roster/registrations', id, where: { status: 'pending' } },
        ] });
    };

    it('commits every write together under its guards', async () => {
        const [approved, updated] = await approve('r1');
        expect(approved).toMatchObject({ id: 'r1', status: 'approved', rev: 2 });
        expect(updated).toMatchObject({ id: 'm', approved: 1 });
        await approve('r2');
        expect(await shift()).toMatchObject({ approved: 2 });
    });

    it('writes nothing when a guard does not hold, and names it', async () => {
        const before = await shift();
        await expect(approve('r3')).rejects.toMatchObject({ code: 'CMS_CONFLICT', fields: { capacity: 'does not hold.' } });
        expect(await registration('r3')).toMatchObject({ status: 'pending', rev: 1 });
        expect(await shift()).toMatchObject({ approved: 2, rev: before.rev });
        // No assertion row outlives its batch.
        expect((await cms.db.read([{ rql: 'SELECT count(*) FROM cms_assertions' }])).results[0]!.rows[0]![0]).toBe(0n);
    });

    it('writes nothing when a record changed since it was read', async () => {
        const current = await shift();
        await expect(context.cms.batch([
            { create: 'roster/registrations', input: { shift: 'm' }, id: 'r4' },
            { update: 'roster/shifts', id: 'm', patch: { title: 'Early' }, expectedRevision: current.rev - 1 },
        ], { principal: ada })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        expect(await cms.resource('roster/registrations').get('r4', { principal: system })).toBeNull();
        // Changed after its write was prepared, before the batch ran: the request itself refuses it.
        await expect(context.cms.batch([
            { update: 'roster/shifts', id: 'm', patch: { title: 'Early' }, expectedRevision: current.rev },
            { create: 'roster/registrations', input: { shift: 'm', note: 'race' }, id: 'r4' },
        ], { principal: ada })).rejects.toMatchObject({ code: 'CMS_CONFLICT', fields: { 'roster/shifts:m': 'changed since it was read.' } });
        expect(await cms.resource('roster/registrations').get('r4', { principal: system })).toBeNull();
        expect(await shift()).toMatchObject({ title: 'Renamed meanwhile', rev: current.rev + 1 });
    });

    it('rolls back a batch whose create collides, and refuses writing a record twice', async () => {
        const current = await shift();
        await expect(context.cms.batch([
            { update: 'roster/shifts', id: 'm', patch: { title: 'Late' }, expectedRevision: current.rev },
            { create: 'roster/registrations', input: { shift: 'm' }, id: 'r1' },
        ], { principal: ada })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        expect(await shift()).toMatchObject({ title: 'Renamed meanwhile', rev: current.rev });
        await expect(context.cms.batch([
            { update: 'roster/shifts', id: 'm', patch: { title: 'A' }, expectedRevision: current.rev },
            { update: 'roster/shifts', id: 'm', patch: { title: 'B' }, expectedRevision: current.rev },
        ], { principal: ada })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    });

    it('checks each write as it would be checked alone', async () => {
        // Access: the audit resource takes no creates from users.
        await expect(context.cms.batch([{ create: 'roster/audit', input: { note: 'x' } }], { principal: ada })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        // Validation, before anything is sent.
        await expect(context.cms.batch([{ create: 'roster/shifts', input: { title: 'No capacity' } }], { principal: system })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        // A plugin's batch reaches only its own resources and its granted ones.
        await expect(context.cms.batch([{ create: 'cms/posts', input: { title: 'x' } }], { principal: system })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(context.cms.batch([{ create: 'roster/registrations', input: { shift: 'm' } }], { principal: system, guards: [{ name: 'posts', resource: 'cms/posts' }] })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(context.cms.batch([], { principal: system })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    });

    it('queues each write\'s event and audit row when the batch commits', async () => {
        const [created] = await cms.batch([{ create: 'roster/registrations', input: { shift: 'm' }, id: 'r5' }], { principal: ada, guards: [{ name: 'shift', resource: 'roster/shifts', id: 'm' }] });
        expect(created).toMatchObject({ id: 'r5', owner: 'ada' });
        const audit = await cms.db.read([{ rql: `SELECT action FROM cms_audit WHERE resource = 'roster/registrations' AND record_id = 'r5'` }]);
        expect(audit.results[0]!.rows).toEqual([['create']]);
    });
});
