import { beforeAll, describe, expect, it } from 'vitest';
import { createHookRegistry } from '@cossackframework/core/hooks';
import { afterCommit, createCMS, defineResource, field, isLockedRecord, lockedView, systemPrincipal, userPrincipal, withheldFieldNames, type CmsHost, type RecordShape, type ResourceEvent } from '../src/server/index';
import { romedbService, live } from './helpers';

const notes = defineResource({
    name: 'diary',
    titleField: 'title',
    fields: {
        title: field.string({ required: true, max: 100 }),
        slug: field.string({ max: 100 }),
        body: field.text({ search: true }),
        summary: field.text(),
        password: field.string({ max: 100 }),
        membersOnly: field.boolean({ default: false }),
        topics: field.string({ multiple: true, taxonomy: 'topics' }),
    },
    access: { read: 'public', create: 'authenticated', update: { permission: 'app/diary:update' }, delete: { permission: 'app/diary:delete' } },
});

/** The same entries without a taxonomy, for a host with no taxonomy module. */
const diary = defineResource({ ...notes, fields: Object.fromEntries(Object.entries(notes.fields).filter(([name]) => name !== 'topics')) });

const record = (fields: Record<string, unknown>): RecordShape => ({ id: 'e1', rev: 1, createdAt: 1, updatedAt: 1, owner: null, title: 'Title', slug: 'title', ...fields }) as RecordShape;

describe('the reader\'s view of a locked entry', () => {
    it('keeps core fields, taxonomies and the lock, and drops the password and content', () => {
        expect([...withheldFieldNames(notes.fields)].sort()).toEqual(['body', 'password', 'summary']);
        const locked = record({ body: 'secret body', summary: 'secret summary', password: 'hunter2', topics: ['t1'] });
        expect(isLockedRecord(locked)).toBe(true);
        const view = lockedView(locked, notes.fields);
        expect(view).toMatchObject({ id: 'e1', title: 'Title', slug: 'title', topics: ['t1'] });
        expect(JSON.stringify(view)).not.toMatch(/secret|hunter2/);
        const members = lockedView(record({ body: 'secret body', membersOnly: true }), notes.fields);
        expect(members).toMatchObject({ membersOnly: true });
        expect(members).not.toHaveProperty('body');
    });

    it('leaves an open entry whole, less an empty password', () => {
        const open = record({ body: 'open body', password: '' });
        expect(isLockedRecord(open)).toBe(false);
        expect(lockedView(open, notes.fields)).toEqual(record({ body: 'open body' }));
    });
});

describe.skipIf(!live)('locked entries in events', () => {
    const service = romedbService();
    const hooks = createHookRegistry();
    const events: ResourceEvent[] = [];
    hooks.addAction(afterCommit, event => { events.push(event); }, { plugin: 'recorder' });
    let cms: CmsHost;
    const editor = userPrincipal('ed', ['editor'], ['app/diary:update', 'app/diary:read']);
    const reader = userPrincipal('rae', ['reviewer'], ['app/diary:read']);

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), resources: [diary], hooks });
        expect((await cms.migrate()).failed).toBeUndefined();
    });

    it('sends webhooks, plugins and automations the reader\'s view, and gives only editors the record whole', async () => {
        const repository = cms.resource('app/diary');
        await repository.create({ title: 'Locked', body: 'secret body', summary: 'secret summary', password: 'hunter2' }, { principal: systemPrincipal('test'), id: 'locked' });
        const stored = await repository.get('locked', { principal: editor });
        expect(repository.readerView(stored!, editor)).toMatchObject({ body: 'secret body', password: 'hunter2' });
        expect(JSON.stringify(repository.readerView(stored!, reader))).not.toMatch(/secret|hunter2/);
        const outbox = await cms.db.read([{ rql: "SELECT payload FROM cms_outbox WHERE topic = 'resource.created'" }]);
        const payloads = outbox.results[0]!.rows.map(row => String(row[0]));
        expect(payloads.some(payload => payload.includes('"id":"locked"'))).toBe(true);
        expect(payloads.join('\n')).not.toMatch(/secret|hunter2/);
        await cms.outbox.dispatch();
        const delivered = events.find(event => event.id === 'locked');
        expect(delivered?.record).toMatchObject({ title: 'Locked' });
        expect(JSON.stringify(delivered)).not.toMatch(/secret|hunter2/);
    });
});
