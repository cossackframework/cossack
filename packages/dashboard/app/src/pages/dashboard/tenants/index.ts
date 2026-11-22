import { Cossack, Page, Server, State, type HeadValue } from '@cossackframework/core';
import { input } from '@cossackframework/core/input';
import { Badge, Button, Card, CardBody, CardHeader } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { notice, pageHeader } from '@cossackframework/ui/blocks';
import {
    addTenantDomain, addTenantMember, createTenant, listTenantMembers, listTenants, onMainHost, removeTenantDomain, removeTenantMember,
    setTenantStatus, tenantOrigin, tenantsAvailable, type PublicUser, type TenantMemberSummary, type TenantSummary,
} from '#app/auth';
import { guard } from '#app/services/rbac';

const text = (max: number) => input.string({ maxLength: max });
const FIELD = 'h-9 rounded-md border border-input bg-background px-3 text-sm';

/**
 * Tenants: organizations with their own database, members and roles (src/dashboard.config.ts:
 * `tenants`). The main host's administrators make and archive them here, give them domains
 * and choose their members. A tenant's own Users and Roles screens are on its host.
 */
@Page({ transport: 'http', middlewares: [guard.requireRole('admin')] })
export default class TenantsPage extends Cossack {
    @State() tenants: (TenantSummary & { address: string | null })[] = [];
    @State() selected = '';
    @State() members: TenantMemberSummary[] = [];
    @State() message = '';
    @State() error = '';
    @State() name = '';
    @State() slug = '';
    @State() domain = '';
    @State() email = '';

    head(): HeadValue {
        return { title: 'Tenants' };
    }

    async init() {
        // The guard answers 404 where tenants are off or the host is a tenant's.
        if (tenantsAvailable && onMainHost()) await this.load();
    }

    private async load() {
        this.tenants = (await listTenants()).map(tenant => ({ ...tenant, address: tenantOrigin(tenant) }));
        this.members = this.selected ? await listTenantMembers(this.selected) : [];
    }

    private async act(work: () => Promise<void>, done: string) {
        this.message = ''; this.error = '';
        if (!tenantsAvailable || !onMainHost()) { this.error = 'Tenants are managed on the main host.'; return; }
        try { await work(); this.message = done; } catch (error) { this.error = error instanceof Error ? error.message : 'Something went wrong.'; }
        await this.load();
    }

    @Server({ input: input.args(text(120), text(63)) })
    async create(name: string, slug: string) {
        await this.act(async () => {
            const tenant = await createTenant({ name, slug }, this.user as PublicUser);
            this.selected = tenant.id; this.name = ''; this.slug = '';
        }, 'The tenant is ready. You are its first administrator.');
    }

    @Server({ input: input.args(text(200)) })
    async open(id: string) {
        this.selected = this.selected === id ? '' : id;
        await this.act(async () => undefined, '');
    }

    @Server({ input: input.args(text(200), input.boolean()) })
    async archive(id: string, archived: boolean) {
        await this.act(() => setTenantStatus(id, archived ? 'archived' : 'active'), archived ? 'Archived: its hosts answer 503 and its data stays.' : 'The tenant is active again.');
    }

    @Server({ input: input.args(text(200), text(191)) })
    async addDomain(id: string, host: string) {
        await this.act(async () => { await addTenantDomain(id, host); this.domain = ''; }, 'Added the domain. Point it at this application.');
    }

    @Server({ input: input.args(text(200), text(191)) })
    async removeDomain(id: string, host: string) {
        await this.act(() => removeTenantDomain(id, host), 'Removed the domain.');
    }

    @Server({ input: input.args(text(200), text(320)) })
    async addMember(id: string, email: string) {
        await this.act(async () => { await addTenantMember(id, email); this.email = ''; }, 'Added the member. Give them roles on the tenant\'s Users screen.');
    }

    @Server({ input: input.args(text(200), text(200)) })
    async removeMember(id: string, userId: string) {
        await this.act(() => removeTenantMember(id, userId), 'Removed the member. Their account stays.');
    }

    private details(tenant: TenantSummary) {
        return html`<div class="space-y-4 border-t border-border px-4 py-4 text-sm" data-testid="tenant-details">
            <div class="space-y-2">
                <h3 class="font-medium text-foreground">${__('Domains')}</h3>
                ${tenant.domains.length ? html`<ul class="space-y-1">${tenant.domains.map(host => html`<li class="flex items-center justify-between gap-2"><span>${host}</span>
                    ${component(Button, { size: 'sm', variant: 'outline', '@click': () => this.removeDomain(tenant.id, host) }, __('Remove'))}</li>`)}</ul>` : html`<p class="text-muted-foreground">${__('No domain of its own.')}</p>`}
                <form class="flex flex-wrap gap-2" @submit=${(event: Event) => { event.preventDefault(); void this.addDomain(tenant.id, this.domain); }}>
                    <input class=${FIELD} name="domain" aria-label=${__('Domain')} placeholder="app.example.com" .value=${this.domain} @input=${(event: Event) => { this.domain = (event.target as HTMLInputElement).value; }}>
                    ${component(Button, { size: 'sm', type: 'submit' }, __('Add domain'))}
                </form>
            </div>
            <div class="space-y-2">
                <h3 class="font-medium text-foreground">${__('Members')}</h3>
                <ul class="space-y-1" data-testid="tenant-members">${this.members.map(member => html`<li class="flex flex-wrap items-center justify-between gap-2">
                    <span><span class="font-medium text-foreground">${member.name || member.email}</span> <span class="text-muted-foreground">${member.email}</span>
                        ${member.roles.map(role => component(Badge, { variant: 'secondary' }, role))}</span>
                    ${component(Button, { size: 'sm', variant: 'outline', '@click': () => this.removeMember(tenant.id, member.id) }, __('Remove'))}</li>`)}</ul>
                <form class="flex flex-wrap gap-2" @submit=${(event: Event) => { event.preventDefault(); void this.addMember(tenant.id, this.email); }}>
                    <input class=${FIELD} type="email" name="email" aria-label=${__('Email of an account')} placeholder="person@example.com" .value=${this.email} @input=${(event: Event) => { this.email = (event.target as HTMLInputElement).value; }}>
                    ${component(Button, { size: 'sm', type: 'submit' }, __('Add member'))}
                </form>
            </div>
        </div>`;
    }

    render() {
        return html`<div class="space-y-6">
            ${pageHeader(__('Tenants'), { description: __('Organizations with their own database, members and roles.') })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            ${component(Card, {}, [component(CardHeader, {}, html`<h2 class="text-sm font-medium">${__('New tenant')}</h2>`), component(CardBody, {}, html`
                <form class="flex flex-wrap items-end gap-2" data-testid="new-tenant" @submit=${(event: Event) => { event.preventDefault(); void this.create(this.name, this.slug); }}>
                    <input class=${FIELD} name="name" aria-label=${__('Name')} placeholder=${__('Name')} .value=${this.name} @input=${(event: Event) => { this.name = (event.target as HTMLInputElement).value; }}>
                    <input class=${FIELD} name="slug" aria-label=${__('Address')} placeholder="acme" .value=${this.slug} @input=${(event: Event) => { this.slug = (event.target as HTMLInputElement).value; }}>
                    ${component(Button, { size: 'sm', type: 'submit' }, __('Create'))}
                </form>`)])}
            ${component(Card, {}, component(CardBody, { class: 'p-0' }, this.tenants.length ? html`<ul class="divide-y divide-border" data-testid="tenants">${this.tenants.map(tenant => html`<li>
                <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span><span class="font-medium text-foreground">${tenant.name}</span>
                        ${tenant.address ? html`<a class="ml-2 text-muted-foreground underline" href=${tenant.address}>${tenant.address.replace(/^https?:\/\//, '')}</a>` : html`<span class="ml-2 text-muted-foreground">${tenant.slug}</span>`}
                        <span class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">${tenant.members} ${__('members')}
                            ${tenant.status === 'active' ? null : component(Badge, { variant: 'outline' }, tenant.status === 'archived' ? __('Archived') : __('Not ready'))}</span></span>
                    <span class="flex gap-2">
                        ${component(Button, { size: 'sm', variant: 'outline', '@click': () => this.open(tenant.id) }, this.selected === tenant.id ? __('Close') : __('Manage'))}
                        ${tenant.status === 'creating' ? null : component(Button, { size: 'sm', variant: 'outline', '@click': () => this.archive(tenant.id, tenant.status === 'active') }, tenant.status === 'active' ? __('Archive') : __('Restore'))}
                    </span>
                </div>
                ${this.selected === tenant.id ? this.details(tenant) : null}
            </li>`)}</ul>` : html`<p class="px-4 py-6 text-sm text-muted-foreground">${__('No tenant yet.')}</p>`))}
        </div>`;
    }
}
