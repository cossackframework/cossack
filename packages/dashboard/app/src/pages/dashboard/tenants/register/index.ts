import { Cossack, Page, Server, State, type HeadValue } from '@cossackframework/core';
import { input } from '@cossackframework/core/input';
import { Button, Card, CardBody, CardHeader } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { notice, pageHeader } from '@cossackframework/ui/blocks';
import { registerTenant, tenantOrigin, tenantRegistrationOpen, tenantsAvailable, tenantsOf, onMainHost, type PublicUser } from '#app/auth';

const FIELD = 'h-9 rounded-md border border-input bg-background px-3 text-sm';

/**
 * Your tenants, on the main host: the ones your account is a member of, and a form to make one
 * of your own while the network's registration is on (Tenants → Registration). You are the
 * new tenant's administrator.
 */
@Page({ transport: 'http' })
export default class RegisterTenantPage extends Cossack {
    @State() mine: { name: string; address: string | null }[] = [];
    @State() open = false;
    @State() message = '';
    @State() error = '';
    @State() name = '';
    @State() slug = '';

    head(): HeadValue {
        return { title: 'Your tenants' };
    }

    async init() {
        if (tenantsAvailable && onMainHost()) await this.load();
    }

    private async load() {
        const user = this.user as PublicUser | undefined;
        this.open = await tenantRegistrationOpen();
        this.mine = user ? (await tenantsOf(user.id)).map(tenant => ({ name: tenant.name, address: tenantOrigin(tenant) })) : [];
    }

    @Server({ input: input.args(input.string({ maxLength: 120 }), input.string({ maxLength: 63 })) })
    async register(name: string, slug: string) {
        this.message = ''; this.error = '';
        const user = this.user as PublicUser | undefined;
        if (!user || !tenantsAvailable || !onMainHost()) { this.error = 'Sign in on the main host first.'; return; }
        try {
            await registerTenant({ name, slug }, user);
            this.message = 'Your tenant is ready. You are its administrator.';
            this.name = ''; this.slug = '';
        } catch (error) { this.error = error instanceof Error ? error.message : 'Something went wrong.'; }
        await this.load();
    }

    render() {
        return html`<div class="space-y-6">
            ${pageHeader(__('Your tenants'), { description: __('The organizations your account belongs to.') })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            ${component(Card, {}, component(CardBody, { class: 'p-0' }, this.mine.length ? html`<ul class="divide-y divide-border" data-testid="my-tenants">${this.mine.map(tenant => html`<li class="px-4 py-3 text-sm">
                <span class="font-medium text-foreground">${tenant.name}</span>
                ${tenant.address ? html`<a class="ml-2 text-muted-foreground underline" href=${tenant.address}>${tenant.address.replace(/^https?:\/\//, '')}</a>` : null}</li>`)}</ul>`
                : html`<p class="px-4 py-6 text-sm text-muted-foreground">${__('Your account belongs to no tenant yet.')}</p>`))}
            ${this.open ? component(Card, {}, [component(CardHeader, {}, html`<h2 class="text-sm font-medium">${__('New tenant')}</h2>`), component(CardBody, {}, html`
                <form class="flex flex-wrap items-end gap-2" data-testid="register-tenant" @submit=${(event: Event) => { event.preventDefault(); void this.register(this.name, this.slug); }}>
                    <input class=${FIELD} name="name" aria-label=${__('Name')} placeholder=${__('Name')} .value=${this.name} @input=${(event: Event) => { this.name = (event.target as HTMLInputElement).value; }}>
                    <input class=${FIELD} name="slug" aria-label=${__('Address')} placeholder="acme" .value=${this.slug} @input=${(event: Event) => { this.slug = (event.target as HTMLInputElement).value; }}>
                    ${component(Button, { size: 'sm', type: 'submit' }, __('Create'))}
                </form>`)]) : null}
        </div>`;
    }
}
