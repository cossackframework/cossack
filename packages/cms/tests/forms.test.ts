import { beforeAll, describe, expect, it } from 'vitest';
import { createHookRegistry } from '@cossackframework/core/hooks';
import {
    ANONYMOUS, contentModule, createCMS, DEFAULT_ROLES, formsModule, formSubmitted, formValidate, isCmsError,
    type Block, type CmsHost, type FormSubmittedEvent, type Principal, type RecordShape,
} from '../src/server/index';
import { romedbService, live } from './helpers';

const admin: Principal = { kind: 'user', id: 'admin-1', roles: ['admin'], permissions: ['*'] };
const input = (id: string, type: string, data: { [key: string]: unknown }, extra: Partial<Block> = {}): Block => ({ id, type: `form/${type}`, data: { label: id, ...data }, ...extra });
const contactBody: Block[] = [
    input('n', 'text', { name: 'name', label: 'Your name', required: true }),
    input('e', 'email', { name: 'email', label: 'Email', required: true }),
    input('t', 'select', { name: 'topic', label: 'Topic', options: ['sales|Sales', 'support|Support'] }),
    input('m', 'textarea', { name: 'message', label: 'Message', required: true }),
    input('c', 'checkbox', { name: 'callMe', label: 'Call me' }),
    input('p', 'phone', { name: 'phone', label: 'Phone', required: true }, { when: { rules: [{ field: 'callMe', op: 'is', value: 'true' }] } }),
];

describe.skipIf(!live)('forms', () => {
    const service = romedbService();
    const sent: { to: string; from: string; subject: string; text: string; replyTo?: string }[] = [];
    let failFor: string | null = null;
    const events: FormSubmittedEvent[] = [];
    let clock = Date.UTC(2026, 9, 21, 9, 0);
    let cms: CmsHost;
    let editor: Principal;
    let contact: RecordShape;
    const tick = (ms = 10_000) => { clock += ms; };
    const submit = (values: { [name: string]: unknown }, extra: { ip?: string; trap?: string; principal?: Principal; startedAt?: number } = {}) =>
        cms.forms.submit('contact', values, { principal: extra.principal ?? ANONYMOUS, ip: extra.ip ?? '203.0.113.7', userAgent: 'Test', page: '/contact', origin: 'https://example.com', ...(extra.trap ? { trap: extra.trap } : {}), ...(extra.startedAt !== undefined ? { startedAt: extra.startedAt } : {}) });

    beforeAll(async () => {
        const hooks = createHookRegistry();
        cms = createCMS({
            db: service.database(), modules: [contentModule, formsModule], hooks, now: () => clock, mailFrom: 'site@example.com',
            mail: { async send(message) { if (failFor && message.to === failFor) throw new Error('mail is down'); sent.push(message); } },
            fetch: async () => new Response('ok'),
        });
        // A plugin's checks and actions, as a plugin's server.ts registers them.
        hooks.addFilter(formValidate, (errors, { input: { values } }) => typeof values.email === 'string' && values.email.endsWith('@blocked.example') ? { ...errors, email: 'We cannot take this address.' } : errors, { plugin: 'acme' });
        hooks.addAction(formSubmitted, event => { events.push(event); }, { plugin: 'acme' });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready({ force: true });
        for (const role of DEFAULT_ROLES) await cms.users.defineRole({ ...role, permissions: [...role.permissions] });
        editor = (await cms.users.principal((await cms.users.create({ email: 'editor@example.com', name: 'Editor', roles: ['editor'] })).id))!;
        await cms.settings.update('general', { adminEmail: 'admin@example.com', siteTitle: 'Example' }, { principal: admin });
        contact = await cms.resource('cms/forms').create({
            title: 'Contact', body: contactBody,
            notifications: { rules: [
                { id: 'admin', label: 'Admin', to: '{admin_email}', subject: 'New message from {field:name}', body: '{all_fields}\n\n{submission:url}', replyTo: '{field:email}' },
                { id: 'auto', label: 'Autoresponder', to: '{field:email}', subject: 'Thanks, {field:name}', body: 'We will reply soon.', when: { rules: [{ field: 'topic', op: 'is', value: 'support' }] } },
            ] },
        }, { principal: editor });
    }, 60_000);

    it('keeps each form in its own table', async () => {
        expect(contact.slug).toBe('contact');
        const form = (await cms.forms.get('contact'))!;
        expect(form.resource.storage).toBe(`r__cms__form_${contact.id.replaceAll('-', '')}`);
        expect(form.ref.inputs.map(entry => entry.name)).toEqual(['name', 'email', 'topic', 'message', 'callMe', 'phone']);
        const info = await cms.db.read([{ rql: 'INFO FOR DB' }]);
        expect(((info.results[0]!.rows[0]![0] as { tables: { name: string }[] }).tables).map(table => table.name)).toContain(form.resource.storage);
        // Found by ID too; an unknown slug is no form.
        expect((await cms.forms.get(contact.id))?.ref.slug).toBe('contact');
        expect(await cms.forms.get('nothing-here')).toBeNull();
    });

    it('takes a submission, its details and its notifications once', async () => {
        const { submission, confirmation } = await submit({ name: 'Ada', email: 'ada@example.com', topic: 'support', message: 'Help *me*', phone: '' });
        expect(confirmation).toEqual({ kind: 'message', message: 'Thanks! We received your submission.' });
        expect(submission).toMatchObject({ status: 'new', values: { name: 'Ada', email: 'ada@example.com', topic: 'support', message: 'Help *me*', callMe: false }, meta: { ip: '203.0.113.7', userAgent: 'Test', page: '/contact' }, user: null });
        const form = (await cms.forms.get('contact'))!;
        const stored = await cms.forms.submission(form, submission.id, editor);
        expect(stored).toMatchObject({ values: submission.values, meta: submission.meta, status: 'new' });
        // The second autoresponder recipient fails once; the retry sends it alone.
        failFor = 'ada@example.com';
        await cms.outbox.dispatch();
        expect(sent.map(mail => [mail.to, mail.subject])).toEqual([['admin@example.com', 'New message from Ada']]);
        expect(sent[0]).toMatchObject({ from: 'site@example.com', replyTo: 'ada@example.com' });
        expect(sent[0]!.text).toBe(`Your name: Ada\nEmail: ada@example.com\nTopic: Support\nMessage: Help *me*\nCall me: No\n\nhttps://example.com/dashboard/forms/${contact.id}/submissions/${submission.id}`);
        // The plugin's action ran; the failing notification handler is retried after a delay.
        expect(events.map(event => event.submission.id)).toEqual([submission.id]);
        failFor = null;
        tick(60_000);
        await cms.outbox.dispatch();
        expect(sent.map(mail => mail.to)).toEqual(['admin@example.com', 'ada@example.com']);
        expect(events).toHaveLength(1);
    });

    it('checks values, throttles senders and marks spam', async () => {
        tick();
        const invalid = await submit({ name: '', email: 'nope', message: 'x', callMe: 'on' }).catch(error => error);
        expect(isCmsError(invalid, 'CMS_VALIDATION') && invalid.fields).toEqual({ name: 'This field is required.', email: 'Enter an email address, such as name@example.com.', phone: 'This field is required.' });
        // The plugin's filter adds its own error.
        const blocked = await submit({ name: 'Bo', email: 'bo@blocked.example', message: 'x' }).catch(error => error);
        expect(blocked.fields).toEqual({ email: 'We cannot take this address.' });
        await submit({ name: 'Cy', email: 'cy@example.com', message: 'One', callMe: 'on', phone: '+1 555 0100' }, { ip: '198.51.100.1' });
        await expect(submit({ name: 'Cy', email: 'cy@example.com', message: 'Two' }, { ip: '198.51.100.1' })).rejects.toMatchObject({ code: 'CMS_LIMIT' });
        tick();
        // The trap, or a form sent within two seconds of rendering: kept as spam, answered as usual, nothing sent.
        await cms.outbox.dispatch();
        const before = sent.length;
        const trapped = await submit({ name: 'Bot', email: 'bot@example.com', message: 'Buy' }, { ip: '192.0.2.9', trap: 'http://spam.example' });
        const quick = await submit({ name: 'Bot', email: 'bot@example.com', message: 'Buy' }, { ip: '192.0.2.10', startedAt: clock - 500 });
        expect([trapped.submission.status, quick.submission.status, trapped.confirmation.kind]).toEqual(['spam', 'spam', 'message']);
        await cms.outbox.dispatch();
        expect(sent.length).toBe(before);
        const form = (await cms.forms.get('contact'))!;
        expect(await cms.forms.counts(form, editor)).toEqual({ new: 2, read: 0, spam: 2, trash: 0 });
    });

    it('lets editors handle submissions and export them', async () => {
        const form = (await cms.forms.get('contact'))!;
        await expect(cms.forms.list(form, {}, ANONYMOUS)).rejects.toMatchObject({ code: 'CMS_UNAUTHENTICATED' });
        const inbox = await cms.forms.list(form, {}, editor);
        expect(inbox.items.map(item => item.values.name)).toEqual(['Cy', 'Ada']);
        expect((await cms.forms.list(form, { search: 'Ada' }, editor)).items.map(item => item.values.name)).toEqual(['Ada']);
        expect((await cms.forms.list(form, { status: 'spam' }, editor)).items).toHaveLength(2);
        const paged = await cms.forms.list(form, { limit: 1 }, editor);
        expect(paged.items.map(item => item.values.name)).toEqual(['Cy']);
        expect((await cms.forms.list(form, { limit: 1, after: paged.next! }, editor)).items.map(item => item.values.name)).toEqual(['Ada']);
        expect(await cms.forms.setStatus(form, [inbox.items[1]!.id], 'read', editor)).toBe(1);
        expect(await cms.forms.setStatus(form, [inbox.items[1]!.id], 'read', editor)).toBe(0);
        const noted = await cms.forms.setNote(form, inbox.items[0]!.id, 'Called back', editor);
        expect(noted.note).toBe('Called back');
        const spam = (await cms.forms.list(form, { status: 'spam' }, editor)).items.map(item => item.id);
        expect(await cms.forms.delete(form, spam, editor)).toBe(2);
        expect(await cms.forms.counts(form, editor)).toEqual({ new: 1, read: 1, spam: 0, trash: 0 });
        let csv = '';
        for await (const chunk of cms.forms.csv(form, {}, editor)) csv += chunk;
        const lines = csv.trim().split('\r\n');
        expect(lines[0]).toBe('Submitted at,Status,Your name,Email,Topic,Message,Call me,Phone,IP address,Page,Browser,User,Note,ID');
        expect(lines[1]).toContain(",new,Cy,cy@example.com,,One,Yes,'+1 555 0100,198.51.100.1,/contact,Test,,Called back,");
        expect(lines[2]).toContain(',read,Ada,ada@example.com,Support,Help *me*,No,,203.0.113.7');
        expect(lines).toHaveLength(3);
        expect((await cms.forms.inboxCounts([form], editor)).get(contact.id)).toEqual({ fresh: 1, kept: 2 });
    });

    it('adds inputs without touching stored submissions', async () => {
        const forms = cms.resource('cms/forms');
        const current = (await forms.get(contact.id, { principal: editor }))!;
        contact = await forms.update(contact.id, { body: [...contactBody, input('r', 'radio', { name: 'rating', label: 'Rating', options: ['1', '2', '3'] }), input('o', 'text', { name: 'company', label: 'Company' })] }, { principal: editor, expectedRevision: current.rev });
        tick();
        const { submission } = await submit({ name: 'Di', email: 'di@example.com', message: 'Hi', rating: '3', company: 'Zeta Works' }, { ip: '198.51.100.2' });
        const form = (await cms.forms.get('contact'))!;
        expect(form.ref.inputs.map(entry => entry.name)).toContain('rating');
        const items = (await cms.forms.list(form, {}, editor)).items;
        expect(items.map(item => [item.values.name, item.values.rating ?? null])).toEqual([['Di', '3'], ['Cy', null], ['Ada', null]]);
        expect(items[0]!.id).toBe(submission.id);
        // Full-text search was rebuilt over the new text field.
        expect((await cms.forms.list(form, { search: 'Zeta' }, editor)).items.map(item => item.id)).toEqual([submission.id]);
        await cms.outbox.dispatch();
    });

    it('closes forms by their settings', async () => {
        const forms = cms.resource('cms/forms');
        const survey = await forms.create({
            title: 'Survey', body: [input('e', 'email', { name: 'email', required: true }), input('s', 'number', { name: 'score', min: 1, max: 5 })],
            settings: { limit: 2, oncePerEmail: 'email', confirmation: 'redirect', redirectUrl: '/thanks', closedMessage: 'Survey is over.' },
        }, { principal: editor });
        const send = (email: string, ip: string) => cms.forms.submit('survey', { email, score: '4' }, { principal: ANONYMOUS, ip });
        expect((await send('a@example.com', '10.0.0.1')).confirmation).toEqual({ kind: 'redirect', url: '/thanks' });
        await expect(send('a@example.com', '10.0.0.2')).rejects.toMatchObject({ code: 'CMS_CONFLICT', fields: { email: 'This address already sent this form.' } });
        await send('b@example.com', '10.0.0.3');
        await expect(send('c@example.com', '10.0.0.4')).rejects.toMatchObject({ code: 'CMS_FORBIDDEN', message: 'Survey is over.' });
        // Sign-in rules, the schedule and the switch.
        const latest = (await forms.get(survey.id, { principal: editor }))!;
        await forms.update(survey.id, { settings: { oncePerUser: true, opensAt: clock + 60_000 } }, { principal: editor, expectedRevision: latest.rev });
        await expect(send('d@example.com', '10.0.0.5')).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        tick(120_000);
        await expect(send('d@example.com', '10.0.0.5')).rejects.toMatchObject({ code: 'CMS_UNAUTHENTICATED' });
        const first = await cms.forms.submit('survey', { email: 'e@example.com' }, { principal: editor, ip: '10.0.0.6' });
        expect(first.submission.user).toBe(editor.kind === 'user' ? editor.id : '');
        tick();
        await expect(cms.forms.submit('survey', { email: 'f@example.com' }, { principal: editor, ip: '10.0.0.6' })).rejects.toMatchObject({ code: 'CMS_CONFLICT', message: 'You already sent this form.' });
        // Saving checks the settings against the inputs.
        const again = (await forms.get(survey.id, { principal: editor }))!;
        await expect(forms.update(survey.id, { settings: { oncePerEmail: 'score' } }, { principal: editor, expectedRevision: again.rev })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(forms.update(survey.id, { body: [input('a', 'text', { name: 'status' })] }, { principal: editor, expectedRevision: again.rev })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    });

    it('sends without keeping, queues webhooks and drops the table with the form', async () => {
        const forms = cms.resource('cms/forms');
        const hook = await cms.webhooks.save({ name: 'Leads', url: 'https://crm.example.com/hook', events: ['form.submitted'] }, { collections: cms.collections().map(entry => entry.name) });
        const ping = await forms.create({
            title: 'Ping', body: [input('e', 'email', { name: 'email', required: true })], settings: { store: false },
            notifications: { rules: [{ id: 'admin', label: 'Admin', to: 'team@example.com', subject: 'Ping {field:email}', body: '{all_fields}' }] },
        }, { principal: editor });
        const before = sent.length;
        const { submission } = await cms.forms.submit('ping', { email: 'g@example.com' }, { principal: ANONYMOUS, ip: '10.0.1.1' });
        const form = (await cms.forms.get('ping'))!;
        expect(await cms.forms.counts(form, editor)).toEqual({ new: 0, read: 0, spam: 0, trash: 0 });
        await cms.outbox.dispatch();
        expect(sent.slice(before).map(mail => [mail.to, mail.subject])).toEqual([['team@example.com', 'Ping g@example.com']]);
        const deliveries = await cms.webhooks.deliveries(hook.id);
        expect(deliveries.map(delivery => delivery.event)).toContain('form.submitted');
        const payloads = await cms.db.read([{ rql: 'SELECT payload FROM cms_webhook_deliveries WHERE webhook_id = $id', params: { $id: hook.id } }]);
        expect(payloads.results[0]!.rows.map(row => JSON.parse(row[0] as string))).toContainEqual(expect.objectContaining({
            event: 'form.submitted', form: { id: ping.id, slug: 'ping', title: 'Ping' }, submission: expect.objectContaining({ id: submission.id, values: { email: 'g@example.com' }, stored: false }),
        }));
        // Deleting the form drops its table once the outbox runs.
        const contactForm = (await cms.forms.get('contact'))!;
        const latest = (await forms.get(contact.id, { principal: editor }))!;
        await forms.delete(contact.id, { principal: editor, expectedRevision: latest.rev });
        await cms.outbox.dispatch();
        const info = await cms.db.read([{ rql: 'INFO FOR DB' }]);
        expect(((info.results[0]!.rows[0]![0] as { tables: { name: string }[] }).tables).map(table => table.name)).not.toContain(contactForm.resource.storage);
        expect(await cms.forms.get('contact')).toBeNull();
    });

    it('keeps post results once and cleans up', async () => {
        const key = await cms.forms.saveResult('f1', { errors: { email: 'x' } });
        expect(await cms.forms.takeResult('f2', key)).toBeNull();
        expect(await cms.forms.takeResult('f1', key)).toEqual({ errors: { email: 'x' } });
        expect(await cms.forms.takeResult('f1', key)).toBeNull();
        const form = (await cms.forms.get('survey'))!;
        const kept = (await cms.forms.list(form, {}, editor)).items;
        await cms.forms.setStatus(form, [kept[0]!.id], 'trash', editor);
        tick(31 * 24 * 60 * 60 * 1000);
        expect(await cms.forms.maintain()).toEqual({ emptied: 1 });
        const sends = await cms.db.read([{ rql: 'SELECT count(*) FROM cms_form_sends' }]);
        expect(Number(sends.results[0]!.rows[0]![0] as bigint)).toBe(0);
    });
});
