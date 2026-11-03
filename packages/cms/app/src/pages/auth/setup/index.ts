import { Client, Cossack, Page, RateLimit, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { Alert } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { DEFAULT_ROLES, MAIN_SITE, NETWORK_ADMIN, isCmsError, isSameOriginPost, systemPrincipal } from '@cossackframework/cms';
import { normalizeEmail, seedStarterContent } from '@cossackframework/cms/server';
import { authSessions, setupRequired } from '../../../auth';
import { CONTROL } from '../../../cms/ui';
import { importRequest, importSummary, sendsExport } from '../../../cms/site-import';
import { sendExport } from '../../../cms/import.client';

/** Compare digests so the comparison time does not depend on how much of the code matches. */
async function sameSecret(candidate: string, expected: string): Promise<boolean> {
    const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
    const [a, b] = await Promise.all([digest(candidate), digest(expected)]);
    let difference = 0;
    for (let index = 0; index < a.length; index++) difference |= a[index]! ^ b[index]!;
    return difference === 0;
}

/**
 * First run: apply the schema, create the roles and the first administrator, and name the
 * site. A database exported from a network's site has members but no accounts: setup then
 * takes it over, with one of its administrators. A fresh install can also start from a site's
 * JSON export, then take it over. Requires CMS_SETUP_CODE so a fresh deployment cannot be
 * claimed by a visitor.
 */
@Page({ transport: 'http' })
export default class SetupPage extends Cossack {
    @State() done = false;
    @State() error = '';
    /** Members of a site whose database this is, when it came from a network; 0 for a new site. */
    @State() members = 0;
    @State() siteTitle = '';
    /** What an import just brought in. */
    @State() imported = '';
    @State() importing = false;
    @State() importError = '';

    head(): HeadValue {
        return { title: 'Set up your site' };
    }

    async init() {
        this.error = flashed<string>('cms.setup') ?? '';
        this.imported = flashed<string>('cms.setup.imported') ?? '';
        this.done = !(await setupRequired());
        if (!this.done) {
            const cms = this.c.get('cms');
            this.members = await cms.users.count().catch(() => 0);
            if (this.members) this.siteTitle = await cms.settings.get('general.siteTitle').catch(() => '');
        }
    }

    @RateLimit({ window: 60_000, max: 5 })
    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        // An export sent as the request body; everything else is a form.
        const raw = sendsExport(this.c);
        const form = raw ? null : await this.c.req.formData();
        const value = (name: string) => String(form?.get(name) ?? '');
        const expected = (this.c.env as { CMS_SETUP_CODE?: string }).CMS_SETUP_CODE;
        if (!expected || !(await sameSecret(raw ? this.c.req.header('x-cms-setup-code') ?? '' : value('code'), expected))) {
            const message = 'The setup code is not correct. Find CMS_SETUP_CODE in the environment.';
            if (raw) return this.c.json({ error: message }, 403);
            flash('cms.setup', message);
            return this.redirect('/auth/setup');
        }
        if (raw || value('action') === 'import') return this.importSite(raw);
        const cms = this.c.get('cms');
        const report = await cms.migrate();
        if (report.failed) {
            flash('cms.setup', `The schema could not be applied: ${report.failed.message}`);
            return this.redirect('/auth/setup');
        }
        await cms.ready({ force: true });
        if (await cms.accounts.hasNetworkAdmin()) return this.redirect('/auth/login');
        if ((await cms.users.count()) > 0) return this.takeOver(value('email'), value('password'));
        try {
            for (const role of DEFAULT_ROLES) await cms.users.defineRole({ ...role, permissions: [...role.permissions] });
            // The first account runs the network as well as this site.
            const user = await cms.users.create({ email: value('email'), name: value('name'), password: value('password'), roles: ['admin'], networkRole: NETWORK_ADMIN });
            await cms.settings.update('general', { siteTitle: value('siteTitle').trim() || 'My Site', adminEmail: user.email }, { principal: systemPrincipal('setup') });
            // A first post, a category, a contact form and its page, as the administrator, when asked for; a restored database keeps its own content.
            if (value('starter')) {
                try { await seedStarterContent(cms, { principal: (await cms.users.principal(user.id))! }); }
                catch (error) { console.warn(`[cms] the starter content could not be created: ${(error as Error).message}`); }
            }
            const { headers } = await authSessions.create(user.id, this.c);
            headers.forEach((header, name) => this.c.header(name, header, { append: true }));
        } catch (error) {
            flash('cms.setup', isCmsError(error) ? error.message : 'The administrator could not be created.');
            return this.redirect('/auth/setup');
        }
        return this.redirect('/dashboard');
    }

    /** A site's export becomes this install's content; its members then wait for the takeover form. */
    private async importSite(raw: boolean) {
        try {
            if (!(await setupRequired())) throw new Error('This site is set up already.');
            flash('cms.setup.imported', importSummary(await importRequest(this.c, this.c.get('cms'))));
            return raw ? this.c.json({ next: '/auth/setup' }) : this.redirect('/auth/setup');
        } catch (error) {
            const message = isCmsError(error) || error instanceof Error ? (error as Error).message : 'The export could not be imported.';
            if (raw) return this.c.json({ error: message }, 400);
            flash('cms.setup', message);
            return this.redirect('/auth/setup');
        }
    }

    /** Send the export as the request body, so a large file is read as a stream. */
    @Client()
    async upload(event: SubmitEvent) {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        this.importing = true;
        this.importError = '';
        const result = await sendExport(form, { 'x-cms-setup-code': (form.elements.namedItem('code') as HTMLInputElement).value });
        if (result.next) { location.assign(result.next); return; }
        this.importing = false;
        this.importError = result.error ?? '';
    }

    /** A site exported from a network: its members get accounts, and this administrator a password and the network role. */
    private async takeOver(email: string, password: string) {
        const cms = this.c.get('cms');
        try {
            const address = normalizeEmail(email);
            const member = (await cms.users.list({ search: address, limit: 100 })).items.find(user => user.email === address);
            if (!member?.assignments.some(role => role.id === 'admin')) throw new Error('Enter the email of one of this site\'s administrators.');
            await cms.accounts.adoptMembers(MAIN_SITE, member.id, password);
            const { headers } = await authSessions.create(member.id, this.c);
            headers.forEach((header, name) => this.c.header(name, header, { append: true }));
        } catch (error) {
            flash('cms.setup', isCmsError(error) || error instanceof Error ? (error as Error).message : 'The site could not be taken over.');
            return this.redirect('/auth/setup');
        }
        return this.redirect('/dashboard');
    }

    render() {
        const field = (name: string, label: string, type: 'text' | 'email' | 'password', autocomplete: string, options: { minlength?: number; hint?: string } = {}) => html`<div class="space-y-1.5">
            <label for=${`setup-${name}`} class="block text-sm font-medium text-foreground">${label}</label>
            <input id=${`setup-${name}`} name=${name} type=${type} required autocomplete=${autocomplete} minlength=${options.minlength ?? 1} class=${CONTROL}>
            ${options.hint ? html`<p class="text-xs text-muted-foreground">${options.hint}</p>` : null}
        </div>`;
        if (this.done) return html`<div class="space-y-4 text-center">
            <h3 class="text-xl font-semibold text-foreground">${__('Your site is set up')}</h3>
            <a class="text-primary font-medium hover:underline" href="/auth/login">${__('Sign in')}</a>
        </div>`;
        if (this.members) return html`${this.imported ? html`<div class="mb-4">${component(Alert, { variant: 'success' }, this.imported)}</div>` : null}<h3 class="mb-2 text-xl font-semibold text-foreground">${__('Take over this site')}</h3>
            <p class="mb-6 text-sm text-muted-foreground">${this.siteTitle ? `${this.siteTitle}: ` : ''}${__('this database comes from another install, with')} ${this.members} ${this.members === 1 ? __('member') : __('members')}.
                ${__('Sign in as one of its administrators: that account gets this password and runs this install. The site\'s own accounts keep their passwords; members who signed in with a network account get accounts without one, and set it with Forgot password, or you set it under Users.')}</p>
            <form method="post" class="space-y-4">
                ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
                ${field('code', __('Setup code'), 'password', 'off', { hint: __('CMS_SETUP_CODE from the environment.') })}
                ${field('email', __('Administrator email'), 'email', 'username')}
                ${field('password', __('New password'), 'password', 'new-password', { minlength: 8, hint: __('At least 8 characters.') })}
                <button type="submit" class="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground border-none cursor-pointer">${__('Take over the site')}</button>
            </form>`;
        return html`<h3 class="mb-2 text-xl font-semibold text-foreground">${__('Set up your site')}</h3>
            <p class="mb-6 text-sm text-muted-foreground">${__('This creates the database tables and your administrator account.')}</p>
            <form method="post" class="space-y-4">
                ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
                ${field('code', __('Setup code'), 'password', 'off', { hint: __('CMS_SETUP_CODE from the environment.') })}
                ${field('siteTitle', __('Site title'), 'text', 'organization')}
                ${field('name', __('Your name'), 'text', 'name')}
                ${field('email', __('Email'), 'email', 'username')}
                ${field('password', __('Password'), 'password', 'new-password', { minlength: 8, hint: __('At least 8 characters.') })}
                <label class="flex items-start gap-2 text-sm text-foreground cursor-pointer">
                    <input type="checkbox" name="starter" value="on" checked class="mt-0.5">
                    <span>${__('Add starter content')}<span class="block text-xs text-muted-foreground">${__('A first post, an Uncategorized category, a contact form and a Contact page, to edit or delete.')}</span></span>
                </label>
                <button type="submit" class="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground border-none cursor-pointer">${__('Set up')}</button>
            </form>
            <details class="mt-6 rounded-md border border-border p-4" data-site-import>
                <summary class="cursor-pointer text-sm font-medium text-foreground">${__('Moving a site here? Start from its export')}</summary>
                <form method="post" enctype="multipart/form-data" class="mt-4 space-y-4" @submit=${(event: SubmitEvent) => this.upload(event)}>
                    <input type="hidden" name="action" value="import">
                    ${this.importError ? component(Alert, { variant: 'destructive' }, this.importError) : null}
                    <p class="text-sm text-muted-foreground">${__('A JSON export from the site\'s Tools → Export. Its content, settings and members come in; you then take the site over as one of its administrators. Media files are not in exports: copy them to this site\'s storage.')}</p>
                    <div class="space-y-1.5">
                        <label for="import-code" class="block text-sm font-medium text-foreground">${__('Setup code')}</label>
                        <input id="import-code" name="code" type="password" required autocomplete="off" class=${CONTROL}>
                    </div>
                    <div class="space-y-1.5">
                        <label for="import-file" class="block text-sm font-medium text-foreground">${__('Export file')}</label>
                        <input id="import-file" name="file" type="file" required accept=".json,application/json" class="block w-full text-sm text-foreground">
                    </div>
                    <button type="submit" ?disabled=${this.importing} class="inline-flex w-full items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground cursor-pointer">${this.importing ? __('Importing…') : __('Import')}</button>
                </form>
            </details>`;
    }
}
