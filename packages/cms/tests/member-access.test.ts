import { beforeAll, describe, expect, it } from 'vitest';
import { createCMS, defineResource, field, manifestProblems, memberRuleProblems, resourceProblems, ruleScope, systemPrincipal, userPrincipal, type CmsHost, type ResourceDeclaration } from '../src/server/index';
import { romedbService, live } from './helpers';

const system = systemPrincipal('test');
const ada = userPrincipal('ada', ['staff'], []);
const bob = userPrincipal('bob', ['staff'], []);
const member = { resource: 'app/assignments', user: 'user', field: 'branch' } as const;

const branches = defineResource({
    name: 'branches',
    fields: { name: field.string({ required: true }) },
    access: { read: { memberOf: member }, create: 'none', update: { memberOf: member }, delete: 'none' },
});
const assignments = defineResource({
    name: 'assignments',
    fields: { user: field.string({ required: true, index: true }), branch: field.reference('app/branches', { required: true }) },
    access: { read: 'authenticated', create: 'none', update: 'none', delete: 'none' },
});
const shifts = defineResource({
    name: 'shifts',
    ownership: true,
    fields: { title: field.string({ required: true, search: true }), branch: field.reference('app/branches', { required: true }) },
    access: {
        read: { memberOf: { ...member, match: 'branch' } },
        create: { memberOf: { ...member, match: 'branch' } },
        update: { any: ['owner', { memberOf: { ...member, match: 'branch' } }] },
        delete: { memberOf: { ...member, match: 'branch' } },
    },
});

describe('membership access rules', () => {
    it('checks their shape on the declaration', () => {
        expect(resourceProblems({ name: 'x', fields: { a: field.string() }, access: { read: { memberOf: { resource: 'app/y', user: 'user', field: 'a' } } } })).toEqual([]);
        expect(resourceProblems({ name: 'x', fields: { a: field.string() }, access: { read: { memberOf: { resource: 'nope', user: 'user', field: 'a' } } } })).toEqual([expect.stringContaining('memberOf.resource')]);
        expect(resourceProblems({ name: 'x', fields: { a: field.json() }, access: { read: { memberOf: { resource: 'app/y', user: 'user', field: 'a', match: 'a' } } } })).toEqual([expect.stringContaining('memberOf.match')]);
        expect(resourceProblems({ name: 'x', fields: { a: field.string() }, access: { read: { memberOf: { resource: 'app/y', user: 'user', field: 'a', extra: 1 } as never } } })).toEqual([expect.stringContaining('memberOf names')]);
    });

    it('checks them against the membership resource', () => {
        const declared = (id: string): ResourceDeclaration | undefined => ({ 'app/branches': branches, 'app/assignments': assignments, 'app/shifts': shifts } as Record<string, ResourceDeclaration>)[id];
        expect(memberRuleProblems(branches, 'app', declared)).toEqual([]);
        expect(memberRuleProblems(shifts, 'app', declared)).toEqual([]);
        // The record itself needs a reference to this resource; another owner's resource is refused.
        expect(memberRuleProblems({ ...shifts, access: { read: { memberOf: member } } }, 'app', declared)).toEqual([expect.stringContaining('must be a reference to app/shifts')]);
        expect(memberRuleProblems({ ...branches, access: { read: { memberOf: { ...member, resource: 'shop/assignments' } } } }, 'app', declared)).toEqual([expect.stringContaining('must be a resource of app')]);
        expect(memberRuleProblems({ ...branches, access: { read: { memberOf: { ...member, user: 'branch' } } } }, 'app', declared)).toEqual([expect.stringContaining('not a single string field')]);
        expect(memberRuleProblems({ ...shifts, access: { read: { memberOf: { ...member, match: 'title' } } } }, 'app', declared)).toEqual([expect.stringContaining('same kind of value')]);
        expect(() => createCMS({ db: {} as never, resources: [{ ...branches, access: { read: { memberOf: { ...member, user: 'missing' } } } }, assignments] })).toThrow(/missing is not a single string field/);
    });

    it('checks them in plugin manifests against the plugin\'s own resources', () => {
        const manifest = (rule: unknown) => ({
            schemaVersion: 1, name: 'acme', version: '1.0.0',
            resources: [
                { name: 'branches', fields: { name: field.string() }, access: { read: rule } },
                { name: 'user_branches', fields: { user: field.string({ required: true }), branch: field.reference('acme/branches') } },
            ],
        });
        expect(manifestProblems(manifest({ memberOf: { resource: 'acme/user_branches', user: 'user', field: 'branch' } }))).toEqual([]);
        expect(manifestProblems(manifest({ memberOf: { resource: 'acme/missing', user: 'user', field: 'branch' } }))).toEqual([expect.stringContaining('is not a declared resource')]);
        expect(manifestProblems(manifest({ memberOf: null }))).toEqual([expect.stringContaining('memberOf names')]);
    });

    it('scopes users, never anonymous visitors', () => {
        expect(ruleScope({ memberOf: member }, ada)).toEqual({ owner: false, where: [], members: [member] });
        expect(ruleScope({ memberOf: member }, { kind: 'anonymous' })).toBe('deny');
        expect(ruleScope({ any: ['owner', { memberOf: member }] }, ada)).toEqual({ owner: true, where: [], members: [member] });
        expect(ruleScope({ memberOf: member }, system)).toBe('allow');
    });
});

describe.skipIf(!live)('membership access on the database', () => {
    const service = romedbService();
    let cms: CmsHost;

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), resources: [branches, assignments, shifts] });
        expect((await cms.migrate()).failed).toBeUndefined();
        for (const id of ['north', 'south']) await cms.resource('app/branches').create({ name: id }, { principal: system, id });
        await cms.resource('app/assignments').create({ user: 'ada', branch: 'north' }, { principal: system, id: 'ada-north' });
        await cms.resource('app/assignments').create({ user: 'bob', branch: 'south' }, { principal: system, id: 'bob-south' });
        await cms.resource('app/shifts').create({ title: 'North morning', branch: 'north' }, { principal: system, id: 'n1' });
        await cms.resource('app/shifts').create({ title: 'South morning', branch: 'south' }, { principal: system, id: 's1' });
    });

    it('lists, reads, counts and searches only what a membership reaches', async () => {
        const repository = cms.resource('app/shifts');
        expect((await repository.list({}, { principal: ada })).records.map(record => record.id)).toEqual(['n1']);
        expect((await repository.list({}, { principal: bob })).records.map(record => record.id)).toEqual(['s1']);
        expect(await repository.get('s1', { principal: ada })).toBeNull();
        expect(await repository.count({}, { principal: ada })).toBe(1);
        expect((await repository.search('morning', {}, { principal: bob })).map(record => record.id)).toEqual(['s1']);
        expect([...(await repository.getMany(['n1', 's1'], { principal: ada })).keys()]).toEqual(['n1']);
        // The record itself: the branches a member is assigned to.
        expect((await cms.resource('app/branches').list({}, { principal: ada })).records.map(record => record.id)).toEqual(['north']);
        await expect(repository.list({}, { principal: { kind: 'anonymous' } })).rejects.toMatchObject({ code: 'CMS_UNAUTHENTICATED' });
    });

    it('follows the membership as it changes', async () => {
        await cms.resource('app/assignments').create({ user: 'ada', branch: 'south' }, { principal: system, id: 'ada-south' });
        expect((await cms.resource('app/shifts').list({ order: { field: 'title', direction: 'asc' } }, { principal: ada })).records.map(record => record.id)).toEqual(['n1', 's1']);
        const assignment = (await cms.resource('app/assignments').get('ada-south', { principal: system }))!;
        await cms.resource('app/assignments').delete('ada-south', { principal: system, expectedRevision: assignment.rev });
        expect((await cms.resource('app/shifts').list({}, { principal: ada })).records.map(record => record.id)).toEqual(['n1']);
    });

    it('creates only where the user is a member, in the same write', async () => {
        const repository = cms.resource('app/shifts');
        const created = await repository.create({ title: 'North evening', branch: 'north' }, { principal: ada, id: 'n2' });
        expect(created).toMatchObject({ id: 'n2', owner: 'ada' });
        await expect(repository.create({ title: 'South evening', branch: 'south' }, { principal: ada, id: 's2' })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        expect(await repository.get('s2', { principal: system })).toBeNull();
    });

    it('updates and deletes only what a membership reaches, and moves records only to its places', async () => {
        const repository = cms.resource('app/shifts');
        const south = (await repository.get('s1', { principal: system }))!;
        await expect(repository.update('s1', { title: 'Taken' }, { principal: ada, expectedRevision: south.rev })).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        await expect(repository.delete('s1', { principal: ada, expectedRevision: south.rev })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        const north = (await repository.get('n1', { principal: ada }))!;
        const renamed = await repository.update('n1', { title: 'North early' }, { principal: ada, expectedRevision: north.rev });
        expect(renamed.title).toBe('North early');
        // Moving a shift to a branch Ada is not assigned to is refused, and nothing is written.
        await expect(repository.update('n1', { branch: 'south' }, { principal: ada, expectedRevision: renamed.rev })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        expect((await repository.get('n1', { principal: system }))!.branch).toBe('north');
        await repository.delete('n2', { principal: ada, expectedRevision: (await repository.get('n2', { principal: ada }))!.rev });
        expect(await repository.get('n2', { principal: system })).toBeNull();
    });
});
