import { beforeAll, describe, expect, it } from 'vitest';
import { createHookRegistry } from '@cossackframework/core/hooks';
import {
    ANONYMOUS, contentModule, createCMS, DEFAULT_ROLES, formsModule, formSubmitted, formValidate,
    type Block, type CmsHost, type FormFile, type FormSubmittedEvent, type FormValues, type Principal,
} from '../src/server/index';
import { live, memoryStorage, pngBytes, romedbService } from './helpers';

const admin: Principal = { kind: 'user', id: 'admin-1', roles: ['admin'], permissions: ['*'] };
const body: Block[] = [
    { _id: 'n', type: 'form/text', data: { label: 'Name', name: 'name', required: true } },
    { _id: 'f', type: 'form/file', data: { label: 'Attachments', name: 'files', required: true, accept: '.pdf, image/*', maxSize: 1, multipleFiles: true, maxFiles: 2 } },
];
const pdf = (name = 'cv.pdf', size = 64) => {
    const bytes = new Uint8Array(size);
    bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
    return new File([bytes], name, { type: 'application/pdf' });
};
const png = (name = 'me.png') => new File([pngBytes(4, 3)], name, { type: 'image/png' });
const bytesOf = async (stream: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(stream).arrayBuffer());

describe.skipIf(!live)('form file uploads', () => {
    const service = romedbService();
    const storage = memoryStorage();
    const sent: { to: string; subject: string; text: string }[] = [];
    const events: FormSubmittedEvent[] = [];
    /** The values `cms.form.validate` saw. */
    const validated: FormValues[] = [];
    let clock = Date.UTC(2026, 10, 8, 9, 0);
    let cms: CmsHost;
    let editor: Principal;
    let author: Principal;
    let formId: string;
    let ip = 0;
    const tick = (ms = 10_000) => { clock += ms; };
    const submit = (values: { [name: string]: unknown }) => { tick(); return cms.forms.submit('jobs', values, { principal: ANONYMOUS, ip: `203.0.113.${++ip}`, page: '/jobs', origin: 'https://example.com' }); };
    const rows = async () => (await cms.db.read([{ rql: 'SELECT id, key, status FROM cms_files ORDER BY key' }])).results[0]!.rows.map(row => ({ id: row[0] as string, key: row[1] as string, status: row[2] as string }));
    const privateKeys = () => [...storage.objects.keys()].filter(key => key.startsWith('cms/private/')).sort();

    beforeAll(async () => {
        const hooks = createHookRegistry();
        cms = createCMS({
            db: service.database(), modules: [contentModule, formsModule], hooks, now: () => clock, storage, mailFrom: 'site@example.com',
            mail: { async send(message) { sent.push(message); } }, fetch: async () => new Response('ok'),
        });
        hooks.addFilter(formValidate, (errors, { input: { values } }) => { validated.push(values); return errors; }, { plugin: 'acme' });
        hooks.addAction(formSubmitted, event => { events.push(event); }, { plugin: 'acme' });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready({ force: true });
        for (const role of DEFAULT_ROLES) await cms.users.defineRole({ ...role, permissions: [...role.permissions] });
        editor = (await cms.users.principal((await cms.users.create({ email: 'editor@example.com', name: 'Editor', roles: ['editor'] })).id))!;
        author = (await cms.users.principal((await cms.users.create({ email: 'author@example.com', name: 'Author', roles: ['author'] })).id))!;
        const form = await cms.resource('cms/forms').create({
            title: 'Jobs', status: 'published', body,
            notifications: { rules: [{ id: 'team', label: 'Team', to: 'team@example.com', subject: 'Application from {field:name}', body: '{all_fields}' }] },
        }, { principal: editor });
        formId = form.id;
    }, 60_000);

    it('stores accepted files privately and links them from the submission', async () => {
        const { submission } = await submit({ name: 'Ada', files: [pdf(), png()] });
        const files = submission.values.files as readonly FormFile[];
        expect(files).toEqual([
            { id: expect.any(String), name: 'cv.pdf', size: 64, type: 'application/pdf' },
            { id: expect.any(String), name: 'me.png', size: 29, type: 'image/png' },
        ]);
        // The bytes are under the submission's private keys, and the rows are ready with it.
        const keys = files.map(file => `cms/private/forms/${formId}/${submission.id}/${file.id}`);
        expect(privateKeys()).toEqual([...keys].sort());
        expect((await rows()).filter(row => keys.includes(row.key)).map(row => row.status)).toEqual(['ready', 'ready']);
        const form = (await cms.forms.get('jobs'))!;
        expect((await cms.forms.submission(form, submission.id, editor))?.values.files).toEqual(files);
        // Hooks see the files' metadata, never the files.
        expect(validated.at(-1)?.files).toEqual([{ name: 'cv.pdf', size: 64, type: 'application/pdf' }, { name: 'me.png', size: 29, type: 'image/png' }]);
        expect((validated.at(-1)?.files as readonly object[])[0]).not.toBeInstanceOf(Blob);
    });

    it('refuses wrong types, files too big and contents that are not their type, as the field\'s error', async () => {
        const before = privateKeys();
        const refused = (values: { [name: string]: unknown }) => submit({ name: 'Bo', ...values }).then(() => null, error => ({ code: error.code, fields: error.fields }));
        expect(await refused({ files: [new File(['notes'], 'notes.txt', { type: 'text/plain' })] })).toEqual({ code: 'CMS_VALIDATION', fields: { files: 'notes.txt is not an allowed type. Choose .pdf, image/*.' } });
        expect(await refused({ files: [pdf('big.pdf', 1024 * 1024 + 1)] })).toEqual({ code: 'CMS_VALIDATION', fields: { files: 'big.pdf is larger than 1 MB.' } });
        expect(await refused({ files: [pdf(), pdf('b.pdf'), pdf('c.pdf')] })).toEqual({ code: 'CMS_VALIDATION', fields: { files: 'Choose at most 2 files.' } });
        // The name and the declared type say PDF; the content is not one. The PNG stored before it goes too.
        expect(await refused({ files: [png(), new File(['<html><script>alert(1)</script>'], 'fake.pdf', { type: 'application/pdf' })] }))
            .toEqual({ code: 'CMS_VALIDATION', fields: { files: 'fake.pdf: The file is not a valid application/pdf file.' } });
        // A JSON post can name files but not send them.
        expect(await refused({ files: [{ name: 'cv.pdf', size: 10, type: 'application/pdf' }] })).toEqual({ code: 'CMS_VALIDATION', fields: { files: 'Attach cv.pdf itself: send the form as multipart form data.' } });
        expect(privateKeys()).toEqual(before);
        expect((await rows()).filter(row => row.status !== 'ready')).toEqual([]);
    });

    it('keeps the files out of the media library and the public media route', async () => {
        const form = (await cms.forms.get('jobs'))!;
        const [submission] = (await cms.forms.list(form, {}, editor)).items;
        const file = (submission!.values.files as readonly FormFile[])[1]!;
        const files = cms.files!;
        // What `/media/<id>/<name>` and media references read.
        expect(await files.get(file.id!)).toBeNull();
        expect(await files.open(file.id!)).toBeNull();
        expect(await files.variant(file.id!, { width: 320 })).toBeNull();
        expect((await files.getMany([file.id!])).size).toBe(0);
        expect(await files.list()).toEqual({ items: [], total: 0 });
        expect((await files.summary()).files).toBe(0);
        await expect(files.delete(file.id!, { principal: admin })).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        // Library uploads stay public.
        const logo = await files.upload({ name: 'logo.png', contentType: 'image/png', size: 29, body: new Response(pngBytes(4, 3)).body! }, { principal: editor });
        expect((await files.get(logo.id))?.name).toBe('logo.png');
        expect((await files.list()).total).toBe(1);
        await files.delete(logo.id, { principal: editor });
    });

    it('lets those who handle submissions download the files, and nobody else', async () => {
        const form = (await cms.forms.get('jobs'))!;
        const [submission] = (await cms.forms.list(form, {}, editor)).items;
        const file = (submission!.values.files as readonly FormFile[])[0]!;
        const opened = await cms.forms.file(form, submission!.id, file.id!, editor);
        expect(opened?.file).toMatchObject({ id: file.id, name: 'cv.pdf', contentType: 'application/pdf', size: 64 });
        expect(await bytesOf(opened!.body)).toEqual(await bytesOf(pdf().stream()));
        await expect(cms.forms.file(form, submission!.id, file.id!, ANONYMOUS)).rejects.toMatchObject({ code: 'CMS_UNAUTHENTICATED' });
        await expect(cms.forms.file(form, submission!.id, file.id!, author)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        // Only through its own submission.
        const other = await submit({ name: 'Cy', files: [pdf('other.pdf')] });
        expect(await cms.forms.file(form, other.submission.id, file.id!, editor)).toBeNull();
        expect(await cms.forms.file(form, submission!.id, 'missing', editor)).toBeNull();
    });

    it('lists file names, never contents, in emails, exports, webhooks and plugin actions', async () => {
        const hook = await cms.webhooks.save({ name: 'HR', url: 'https://hr.example.com/hook', events: ['form.submitted'] }, { collections: cms.collections().map(entry => entry.name) });
        const { submission } = await submit({ name: 'Di', files: [pdf('di.pdf')] });
        await cms.outbox.dispatch();
        expect(sent.find(mail => mail.subject === 'Application from Di')?.text).toBe('Name: Di\nAttachments: di.pdf (64 B)');
        const event = events.find(entry => entry.submission.id === submission.id)!;
        expect(event.submission.values.files).toEqual([{ id: expect.any(String), name: 'di.pdf', size: 64, type: 'application/pdf' }]);
        const payloads = await cms.db.read([{ rql: 'SELECT payload FROM cms_webhook_deliveries WHERE webhook_id = $id', params: { $id: hook.id } }]);
        const payload = payloads.results[0]!.rows.map(row => JSON.parse(row[0] as string)).find(entry => entry.submission.id === submission.id);
        expect(payload.submission.values).toEqual({ name: 'Di', files: [{ id: expect.any(String), name: 'di.pdf', size: 64, type: 'application/pdf' }] });
        const form = (await cms.forms.get('jobs'))!;
        let csv = '';
        for await (const chunk of cms.forms.csv(form, {}, editor)) csv += chunk;
        expect(csv.split('\r\n')[0]).toContain('Name,Attachments');
        expect(csv).toContain(',Di,di.pdf (64 B),');
        expect(csv).toContain(',Ada,"cv.pdf (64 B), me.png (29 B)",');
        expect(csv).not.toContain('%PDF');
    });

    it('keeps the files when the answers are edited', async () => {
        const form = (await cms.forms.get('jobs'))!;
        const [submission] = (await cms.forms.list(form, {}, editor)).items;
        const files = submission!.values.files;
        const edited = await cms.forms.setValues(form, submission!.id, { name: 'Di Corrected' }, editor);
        expect(edited.values).toEqual({ name: 'Di Corrected', files });
    });

    it('removes the files with their submission, and every file with the form', async () => {
        const form = (await cms.forms.get('jobs'))!;
        const items = (await cms.forms.list(form, {}, editor)).items;
        const doomed = items.find(item => item.values.name === 'Ada')!;
        const keys = (doomed.values.files as readonly FormFile[]).map(file => `cms/private/forms/${formId}/${doomed.id}/${file.id}`);
        expect(await cms.forms.delete(form, [doomed.id], editor)).toBe(1);
        expect(privateKeys().filter(key => keys.includes(key))).toEqual([]);
        expect((await rows()).filter(row => keys.includes(row.key))).toEqual([]);
        // The others' files stay until the form goes.
        expect(privateKeys()).toHaveLength(items.length - 1);
        const latest = (await cms.resource('cms/forms').get(formId, { principal: editor }))!;
        await cms.resource('cms/forms').delete(formId, { principal: editor, expectedRevision: latest.rev });
        await cms.outbox.dispatch();
        expect(privateKeys()).toEqual([]);
        expect(await rows()).toEqual([]);
    });

    it('sweeps files that no submission made ready', async () => {
        const stashed = await cms.files!.stashPrivate({ name: 'lost.pdf', contentType: 'application/pdf', size: 64, body: pdf('lost.pdf').stream() }, { principal: admin, scope: `forms/${formId}/lost` });
        expect((await rows()).map(row => [row.id, row.status])).toEqual([[stashed.id, 'pending']]);
        tick(16 * 60_000);
        expect(await cms.files!.sweep()).toEqual({ removed: 1 });
        expect(privateKeys()).toEqual([]);
        expect(await rows()).toEqual([]);
    });
});
