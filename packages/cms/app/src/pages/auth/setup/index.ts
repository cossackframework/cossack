import { Cossack, Page, RateLimit, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { Alert } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { DEFAULT_ROLES, isCmsError, isSameOriginPost, systemPrincipal } from '@cossackframework/cms';
import { seedStarterContent } from '@cossackframework/cms/server';
import { authSessions, setupRequired } from '../../../auth';
import { CONTROL } from '../../../cms/ui';

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
 * site. Requires CMS_SETUP_CODE so a fresh deployment cannot be claimed by a visitor.
 */
@Page({ transport: 'http' })
export default class SetupPage extends Cossack {
    @State() done = false;
    @State() error = '';

    head(): HeadValue {
        return { title: 'Set up your site' };
    }

    async init() {
        this.error = flashed<string>('cms.setup') ?? '';
        this.done = !(await setupRequired());
    }

    @RateLimit({ window: 60_000, max: 5 })
    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const form = await this.c.req.formData();
        const value = (name: string) => String(form.get(name) ?? '');
        const expected = (this.c.env as { CMS_SETUP_CODE?: string }).CMS_SETUP_CODE;
        if (!expected || !(await sameSecret(value('code'), expected))) {
            flash('cms.setup', 'The setup code is not correct. Find CMS_SETUP_CODE in the environment.');
            return this.redirect('/auth/setup');
        }
        const cms = this.c.get('cms');
        const report = await cms.migrate();
        if (report.failed) {
            flash('cms.setup', `The schema could not be applied: ${report.failed.message}`);
            return this.redirect('/auth/setup');
        }
        await cms.ready({ force: true });
        if ((await cms.users.count()) > 0) return this.redirect('/auth/login');
        try {
            for (const role of DEFAULT_ROLES) await cms.users.defineRole({ ...role, permissions: [...role.permissions] });
            const user = await cms.users.create({ email: value('email'), name: value('name'), password: value('password'), roles: ['admin'] });
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
            </form>`;
    }
}
