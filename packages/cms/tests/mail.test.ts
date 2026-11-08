import { beforeAll, describe, expect, it } from 'vitest';
import { createHookRegistry } from '@cossackframework/core/hooks';
import { ANONYMOUS, contentModule, createCMS, formsModule, mailBeforeSend, type Block, type CmsHost, type MailMessage, type MailSendInput, type Principal } from '../src/server/index';
import { live, romedbService } from './helpers';

const admin: Principal = { kind: 'user', id: 'admin-1', roles: ['admin'], permissions: ['*'] };
const emailInput: Block = { _id: 'e', type: 'form/email', data: { label: 'Email', name: 'email', required: true } };

describe.skipIf(!live)('site mail', () => {
    const service = romedbService();
    const sent: MailMessage[] = [];
    const inputs: MailSendInput[] = [];
    let cms: CmsHost;

    beforeAll(async () => {
        const hooks = createHookRegistry();
        // A plugin that marks every subject, sends form mail to the desk, tries to take resets, and stops note mail.
        hooks.addFilter(mailBeforeSend, (message, { input }) => {
            inputs.push(input);
            if (!message || input.kind === 'note') return null;
            return { ...message, subject: `${message.subject} (Mail Test)`, to: input.kind === 'reset' ? 'eve@evil.example' : input.kind === 'form' ? 'desk@example.com' : message.to };
        }, { plugin: 'brand' });
        cms = createCMS({
            db: service.database(), modules: [contentModule, formsModule], hooks, mailFrom: 'site@example.com', siteUrl: 'https://mail.example',
            mail: { send: async message => { sent.push(message); } }, fetch: async () => new Response('ok'),
        });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready({ force: true });
        await cms.settings.update('general', { siteTitle: 'Mail Test', logo: '/media/logo.png', adminEmail: 'admin@example.com' }, { principal: admin });
    }, 60_000);

    it('keeps Settings → Email with the other groups and checks its values', async () => {
        expect(cms.settings.groups.find(group => group.id === 'email')).toMatchObject({ label: 'Email', json: true });
        expect(await cms.settings.get('email.accentColor')).toBe('#2563eb');
        await cms.settings.update('email', { accentColor: '#7c3aed', footer: 'You get this because you have an account at Mail Test.' }, { principal: admin });
        await expect(cms.settings.update('email', { accentColor: 'purple' }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(cms.settings.update('email', { logo: 'javascript:alert(1)' }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    });

    it('lays out a password reset, and a filter cannot send it elsewhere', async () => {
        sent.length = 0;
        expect(await cms.mail!.send({ kind: 'reset', to: 'ada@example.com', subject: 'Reset your password', text: 'Choose a new password:\nhttps://mail.example/auth/reset-password?token=abc\n\nThe link works for one hour.' })).toBe(true);
        expect(sent).toHaveLength(1);
        const [message] = sent as [MailMessage];
        expect(message).toMatchObject({ to: 'ada@example.com', from: 'site@example.com', subject: 'Reset your password (Mail Test)' });
        expect(message.text).toContain('token=abc');
        expect(message.html).toContain('<img src="https://mail.example/media/logo.png"');
        expect(message.html).toContain('Mail Test</span>');
        expect(message.html).toContain('bgcolor="#7c3aed"');
        expect(message.html).toMatch(/<a href="https:\/\/mail\.example\/auth\/reset-password\?token=abc"[^>]*>Reset your password<\/a>/);
        expect(message.html).toContain('You get this because you have an account at Mail Test.');
        expect(inputs.at(-1)).toEqual({ kind: 'reset', plugin: null, site: 'main' });
    });

    it('sends form notifications as kind form, which a filter may redirect, and stops what it cancels', async () => {
        sent.length = 0;
        const form = await cms.resource('cms/forms').create({
            title: 'Signup', status: 'published', body: [emailInput],
            notifications: { rules: [{ id: 'admin', label: 'Admin', to: '{admin_email}', subject: 'New signup', body: '{field:email} signed up.' }] },
        }, { principal: admin });
        await cms.outbox.dispatch({ limit: 20 });
        await cms.forms.submit(form.slug as string, { email: 'ada@example.com' }, { principal: ANONYMOUS, ip: '203.0.113.9', userAgent: 'Test', page: '/signup', origin: 'https://mail.example' });
        await cms.outbox.dispatch({ limit: 20 });
        expect(sent.map(message => [message.to, message.subject])).toEqual([['desk@example.com', 'New signup (Mail Test)']]);
        expect(sent[0]!.html).toContain('ada@example.com signed up.');
        expect(inputs.at(-1)).toMatchObject({ kind: 'form' });

        expect(await cms.mail!.send({ kind: 'note', to: 'bob@example.com', subject: 'A note', text: 'See it.' })).toBe(false);
        expect(sent).toHaveLength(1);
    });
});
