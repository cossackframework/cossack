import { Cossack, Page, State, type HeadValue } from '@cossackframework/core';
import { Badge, Card, CardBody } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { PERMISSIONS } from '@cossackframework/cms';
import type { AuditEntry } from '@cossackframework/cms/server';
import { requireAny } from '../../../../../cms/guards';
import { pageHeader, shortDate } from '../../../../../cms/ui';

const PER_PAGE = 50;

/**
 * Tools → Activity: the audit trail of every write, newest first, with who did it and a link to
 * the record. Filter by resource or action; a year of rows is kept.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSettings)] })
export default class ActivityPage extends Cossack {
    @State() items: AuditEntry[] = [];
    @State() total = 0;
    @State() page = 1;
    @State() resource = '';
    @State() action = '';
    @State() resources: string[] = [];
    @State() actions: string[] = [];
    /** Actor IDs to names, for the users among them. */
    @State() names: Record<string, string> = {};

    head(): HeadValue {
        return { title: 'Activity' };
    }

    async init() {
        const cms = this.c.get('cms');
        const page = Number(this.c.req.query('page'));
        this.page = Number.isSafeInteger(page) && page > 0 && page <= 2000 ? page : 1;
        this.resource = (this.c.req.query('resource') ?? '').slice(0, 120);
        this.action = (this.c.req.query('action') ?? '').slice(0, 40);
        const { items, total } = await cms.audit.list({ limit: PER_PAGE, offset: (this.page - 1) * PER_PAGE, ...(this.resource ? { resource: this.resource } : {}), ...(this.action ? { action: this.action } : {}) });
        this.items = items;
        this.total = total;
        const facets = await cms.audit.facets();
        this.resources = facets.resources;
        this.actions = facets.actions;
        const userIds = [...new Set(items.map(entry => entry.actor).filter((actor): actor is string => !!actor && !actor.includes(':') && actor !== 'anonymous'))];
        const users = await cms.users.getMany(userIds);
        this.names = Object.fromEntries([...users].map(([id, user]) => [id, user.name || user.email]));
    }

    /** Where the record is edited: a collection entry, a plugin's resource entry, or nothing for the rest. */
    private href(entry: AuditEntry): string | null {
        const [owner, name] = entry.resource.split('/');
        if (!owner || !name) return null;
        return owner === 'cms' ? `/dashboard/content/${name}/${entry.recordId}` : `/dashboard/content/${owner}.${name}/${entry.recordId}`;
    }

    private link(overrides: { page?: number; resource?: string; action?: string }): string {
        const query = new URLSearchParams();
        const resource = overrides.resource ?? this.resource;
        const action = overrides.action ?? this.action;
        const page = overrides.page ?? 1;
        if (resource) query.set('resource', resource);
        if (action) query.set('action', action);
        if (page > 1) query.set('page', String(page));
        const text = query.toString();
        return `/dashboard/tools/activity${text ? `?${text}` : ''}`;
    }

    render() {
        const pages = Math.max(1, Math.ceil(this.total / PER_PAGE));
        const actor = (entry: AuditEntry) => !entry.actor || entry.actor === 'anonymous' ? __('Visitor') : entry.actor.startsWith('system:') ? `${__('System')} (${entry.actor.slice(7)})` : this.names[entry.actor] ?? entry.actor;
        const chip = (label: string, href: string, on: boolean) => html`<a href=${href} class=${`rounded-full border px-2.5 py-0.5 text-xs no-underline ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:bg-muted'}`}>${label}</a>`;
        return html`<div class="space-y-6">
            ${pageHeader(__('Activity'), { description: __('Every write to the site\'s content and settings: who, what and when. A year is kept.') })}
            <div class="flex flex-wrap items-center gap-2">
                <span class="text-xs text-muted-foreground">${__('Resource')}:</span>${chip(__('All'), this.link({ resource: '' }), !this.resource)}${this.resources.map(name => chip(name, this.link({ resource: name }), name === this.resource))}
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <span class="text-xs text-muted-foreground">${__('Action')}:</span>${chip(__('All'), this.link({ action: '' }), !this.action)}${this.actions.map(name => chip(name, this.link({ action: name }), name === this.action))}
            </div>
            ${component(Card, {}, component(CardBody, { class: 'p-0' }, this.items.length ? html`<table class="w-full text-sm" data-testid="activity">
                <thead><tr class="border-b border-border text-left text-xs uppercase text-muted-foreground"><th class="px-4 py-2">${__('When')}</th><th class="px-4 py-2">${__('Who')}</th><th class="px-4 py-2">${__('Action')}</th><th class="px-4 py-2">${__('Record')}</th><th class="px-4 py-2">${__('Revision')}</th></tr></thead>
                <tbody>${this.items.map(entry => { const href = this.href(entry); return html`<tr class="border-b border-border last:border-0">
                    <td class="whitespace-nowrap px-4 py-2 text-muted-foreground">${shortDate(entry.at)}</td>
                    <td class="px-4 py-2">${actor(entry)}</td>
                    <td class="px-4 py-2">${component(Badge, { variant: entry.action === 'delete' ? 'destructive' : 'secondary' }, entry.action)}</td>
                    <td class="px-4 py-2"><span class="text-muted-foreground">${entry.resource}</span> ${href ? html`<a href=${href} class="text-primary hover:underline">${entry.recordId.slice(0, 8)}…</a>` : html`<code class="text-xs">${entry.recordId.slice(0, 8)}…</code>`}</td>
                    <td class="px-4 py-2 text-muted-foreground">${entry.revision ?? '—'}</td></tr>`; })}</tbody></table>`
                : html`<p class="px-4 py-6 text-sm text-muted-foreground">${__('Nothing recorded yet.')}</p>`))}
            ${pages > 1 ? html`<nav class="flex items-center justify-between text-sm" aria-label=${__('Pages')}>
                ${this.page > 1 ? html`<a href=${this.link({ page: this.page - 1 })} class="text-primary hover:underline">← ${__('Newer')}</a>` : html`<span></span>`}
                <span class="text-muted-foreground">${__('Page')} ${this.page} / ${pages} · ${this.total} ${__('entries')}</span>
                ${this.page < pages ? html`<a href=${this.link({ page: this.page + 1 })} class="text-primary hover:underline">${__('Older')} →</a>` : html`<span></span>`}</nav>` : null}
        </div>`;
    }
}
