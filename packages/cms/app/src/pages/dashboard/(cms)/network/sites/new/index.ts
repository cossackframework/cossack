import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { Card, CardBody } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, isSameOriginPost } from '@cossackframework/cms';
import { notice, pageHeader } from '../../../../../../cms/ui';
import { requireNetworkAdmin } from '../../../../../../cms/guards';
import { network } from '../../../../../../cms/network-ui';
import { field, SUBMIT } from '../../../../../../cms/network-view';

interface NewSiteForm { name: string; host: string; language: string; admin: string; starter: boolean }

/** Add site: a name, an address under the network, a language, the first administrator and starter content. */
@Page({ transport: 'http', middlewares: [requireNetworkAdmin()] })
export default class NewNetworkSite extends Cossack {
    @State() form: NewSiteForm = { name: '', host: '', language: 'en', admin: '', starter: true };
    @State() suffix = '';
    @State() canAdd = false;
    @State() error = '';

    head(): HeadValue {
        return { title: 'Add site' };
    }

    async init() {
        const net = network(this.c);
        const settings = await net.settings();
        this.suffix = settings.subdomainSuffix || net.subdomainSuffix;
        this.canAdd = net.canAddSites;
        // A failed attempt comes back with what was typed.
        this.form = flashed<NewSiteForm>('network.site') ?? { ...this.form, language: settings.defaultLanguage || 'en' };
        this.error = flashed<string>('network.error') ?? '';
    }

    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const data = await this.c.req.formData();
        const value = (name: string) => String(data.get(name) ?? '').trim();
        const form: NewSiteForm = { name: value('name'), host: value('host'), language: value('language').toLowerCase(), admin: value('admin'), starter: data.get('starter') === 'on' };
        const net = network(this.c);
        const principal = this.c.get('principal');
        try {
            const admin = form.admin ? await net.main.accounts.findByEmail(form.admin) : await net.main.accounts.get(principal.kind === 'user' ? principal.id : '');
            if (!admin) throw new Error(__('No account has that email. Add the person under Network → Users first.'));
            const site = await net.createSite({ name: form.name, host: form.host, admin: admin.id, ...(value('id') ? { id: value('id') } : {}), ...(form.language ? { language: form.language } : {}), starter: form.starter }, { principal });
            flash('network.message', `${site.name} ${__('is ready.')}`);
            return this.redirect(`/dashboard/network/sites/${site.id}`);
        } catch (error) {
            flash('network.error', isCmsError(error) || error instanceof Error ? (error as Error).message : __('The site could not be added.'));
            flash('network.site', form);
            return this.redirect('/dashboard/network/sites/new');
        }
    }

    render() {
        return html`<div class="space-y-6">
            ${pageHeader(__('Add site'), {
                description: __('A site with its own database, address and members. Its first administrator signs in with their network account.'),
                actions: html`<a href="/dashboard/network/sites" class="text-sm text-muted-foreground hover:text-foreground">← ${__('Sites')}</a>`,
            })}
            ${this.error ? notice(this.error, 'error') : null}
            ${this.canAdd ? component(Card, { class: 'max-w-xl' }, component(CardBody, {}, html`
                <form method="post" class="space-y-4">
                    ${field('name', __('Name'), { value: this.form.name, required: true })}
                    ${field('host', __('Address'), { value: this.form.host, required: true, placeholder: this.suffix ? `blog.${this.suffix}` : 'blog.example.com',
                        hint: this.suffix ? `${__('A subdomain of')} ${this.suffix}. ${__('Add its own domain once it exists.')}` : '' })}
                    ${field('language', __('Language'), { value: this.form.language, hint: __('A language code, such as en, fr or pt-br.') })}
                    ${field('admin', __('First administrator'), { type: 'email', value: this.form.admin, placeholder: __('Your account when empty'), hint: __('The email of an existing account.') })}
                    <label class="flex items-start gap-2 text-sm text-foreground"><input type="checkbox" name="starter" class="mt-0.5 size-4 accent-primary" ?checked=${this.form.starter}>
                        <span>${__('Add starter content')}<span class="block text-xs text-muted-foreground">${__('Leave it off to fill the site from another site\'s export: its page offers the import while the site is empty.')}</span></span></label>
                    <div class="flex items-center gap-2">
                        <button type="submit" class=${SUBMIT}>${__('Add site')}</button>
                        <a href="/dashboard/network/sites" class="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground no-underline hover:bg-muted">${__('Cancel')}</a>
                    </div>
                </form>`)) : notice(__('This network cannot add sites yet: give it a provider for site databases (see Settings → Network).'))}
        </div>`;
    }
}
