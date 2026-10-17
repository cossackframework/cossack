import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Avatar, Button, Card, CardBody, CardHeader, Input, Textarea, toast } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { plugins } from '@cossackframework/framework/plugins';
import { evaluateRule, hasPermission, isCmsError, PERMISSIONS, recordTitle, richTextFromPlain } from '@cossackframework/cms';
import { linkButton, notice, shortDate } from '../../cms/ui';

/** Components active plugins export as `slots['dashboard.overview']` from their ui.ts. */
function overviewWidgets(active: readonly string[]): TemplateResult[] {
    return plugins.filter(plugin => active.includes(plugin.name)).flatMap(plugin => {
        const slots = (plugin.ui as { slots?: Record<string, unknown[]> } | null)?.slots;
        return (slots?.['dashboard.overview'] ?? []).map(widget => component(widget as never, {}));
    });
}

interface Glance { label: string; href: string; published: number; drafts: number }
interface Item { title: string; href: string; at: number }

/** The dashboard home: at a glance, a quick draft, recent activity and what needs attention. */
@Page({ transport: 'http' })
export default class DashboardPage extends Cossack {
    @State() userName = '';
    @State() userAvatar: string | null = null;
    @State() glance: Glance[] = [];
    @State() media = -1;
    @State() users = -1;
    @State() drafts: Item[] = [];
    @State() published: Item[] = [];
    @State() canDraft = false;
    @State() quick = { title: '', body: '' };
    @State() attention: { text: string; href: string }[] = [];
    @State() outbox = 0;
    @State() unconfirmed = 0;
    @State() canMigrate = false;
    @State() widgets: string[] = [];

    head(): HeadValue {
        return { title: 'Dashboard' };
    }

    async init() {
        const user = this.user;
        this.userName = user?.name ?? '';
        this.userAvatar = user?.avatar ?? null;
        await this.load();
    }

    @Server()
    async load() {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const context = { principal };
        const glance: Glance[] = [];
        for (const collection of cms.collections()) {
            const resource = cms.resourceById(`cms/${collection.name}`);
            if (evaluateRule(resource.access.create, principal) === 'deny' && !hasPermission(principal, `cms/${collection.name}:read`)) continue;
            const repository = cms.resource(resource.id);
            const counts = collection.publishable === false
                ? [await repository.count({}, context).catch(() => 0), 0]
                : await repository.countMany([{ where: { status: 'published' } }, { where: { status: 'draft' } }], context).catch(() => [0, 0]);
            glance.push({ label: collection.label, href: `/dashboard/content/${collection.name}`, published: counts[0]!, drafts: counts[1]! });
        }
        this.glance = glance;
        if (cms.files && (hasPermission(principal, PERMISSIONS.upload) || hasPermission(principal, PERMISSIONS.manageMedia))) this.media = (await cms.files.list({ limit: 1 })).total;
        if (hasPermission(principal, PERMISSIONS.manageUsers)) this.users = (await cms.users.list({ limit: 1 })).total;
        const posts = cms.resource('cms/posts');
        this.canDraft = evaluateRule(posts.resource.access.create, principal) !== 'deny';
        if (this.canDraft) {
            const mine = principal.kind === 'user' ? principal.id : '';
            const drafts = await posts.list({ where: { status: 'draft' }, ...(mine ? { owner: mine } : {}), limit: 5 }, context).catch(() => ({ records: [] }));
            this.drafts = drafts.records.map(record => ({ title: recordTitle(record, 'title'), href: `/dashboard/content/posts/${record.id}`, at: record.updatedAt }));
        }
        const published = await posts.list({ where: { status: 'published' }, order: { field: 'publishedAt', direction: 'desc' }, limit: 5 }, context).catch(() => ({ records: [] }));
        this.published = published.records.map(record => ({ title: recordTitle(record, 'title'), href: `/dashboard/content/posts/${record.id}`, at: Number(record.publishedAt) }));
        const status = await cms.status();
        this.canMigrate = hasPermission(principal, PERMISSIONS.manageSchema);
        // Comments and reviews waiting for someone.
        const waiting: { text: string; href: string }[] = [];
        if (hasPermission(principal, PERMISSIONS.moderateComments)) {
            const pending = await cms.comments.counts().then(counts => counts.pending).catch(() => 0);
            if (pending) waiting.push({ text: `${pending} ${pending === 1 ? __('comment is waiting for moderation.') : __('comments are waiting for moderation.')}`, href: '/dashboard/comments?status=pending' });
        }
        for (const collection of cms.collections()) {
            if (collection.publishable === false || !hasPermission(principal, `cms/${collection.name}:update`)) continue;
            const pending = await cms.resource(`cms/${collection.name}`).count({ where: { status: 'pending' } }, context).catch(() => 0);
            if (pending) waiting.push({ text: `${pending} ${collection.label.toLowerCase()} ${__('pending review.')}`, href: `/dashboard/content/${collection.name}?status=pending` });
        }
        this.attention = [
            ...waiting,
            ...status.resources.filter(resource => !resource.active).map(resource => ({ text: `${resource.id} ${__('is waiting for a schema migration.')}`, href: '/dashboard/tools/schema' })),
            ...status.plugins.filter(plugin => !plugin.active && plugin.missing.length).map(plugin => ({ text: `${plugin.name}: ${plugin.reason ?? __('not enabled.')}`, href: '/dashboard/plugins' })),
        ];
        if (this.canMigrate) {
            this.outbox = (await cms.outbox.pending({ limit: 100 }).catch(() => [])).length;
            this.unconfirmed = (await cms.db.pending.list({ limit: 100 })).length;
        }
        this.widgets = status.plugins.filter(plugin => plugin.active).map(plugin => plugin.name);
    }

    @Client()
    async saveQuickDraft(event: Event) {
        event.preventDefault();
        const created = await this.quickDraft(this.quick.title, this.quick.body);
        if (created) { this.quick = { title: '', body: '' }; toast.success(__('Draft saved.')); }
    }

    @Server()
    async quickDraft(title: string, body: string): Promise<boolean> {
        try {
            await this.c.get('cms').resource('cms/posts').create({ title, body: richTextFromPlain(body), status: 'draft' }, { principal: this.c.get('principal') });
            await this.load();
            return true;
        } catch (error) {
            this.attention = [{ text: isCmsError(error) ? error.message : __('The draft could not be saved.'), href: '/dashboard/content/posts/new' }, ...this.attention];
            return false;
        }
    }

    render() {
        const widgets = overviewWidgets(this.widgets);
        const list = (items: Item[], empty: string) => items.length
            ? html`<ul class="space-y-2">${items.map(item => html`<li class="flex items-baseline justify-between gap-3 text-sm">
                <a href=${item.href} class="truncate text-primary hover:underline">${item.title}</a><span class="shrink-0 text-xs text-muted-foreground">${shortDate(item.at)}</span></li>`)}</ul>`
            : html`<p class="text-sm text-muted-foreground">${empty}</p>`;
        return html`<div class="space-y-6">
            <div class="flex items-center gap-4">
                ${component(Avatar, { src: this.userAvatar ?? undefined, alt: this.userName, size: 48 })}
                <div>
                    <h1 class="text-2xl font-bold text-foreground">${__('Dashboard')}</h1>
                    <p class="text-sm text-muted-foreground">${__('Welcome back')}, ${this.userName}.</p>
                </div>
            </div>
            ${this.attention.map(item => html`<a href=${item.href} class="block no-underline">${notice(item.text, 'error')}</a>`)}
            <div class="grid gap-6 xl:grid-cols-3">
                <div class="space-y-6 xl:col-span-2">
                    ${component(Card, {}, html`
                        ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('At a glance')}</h2>`)}
                        ${component(CardBody, {}, html`<dl class="grid grid-cols-2 gap-4 sm:grid-cols-3">
                            ${this.glance.map(entry => html`<div class="rounded-lg border border-border p-4">
                                <dt class="text-sm text-muted-foreground"><a href=${entry.href} class="no-underline hover:text-foreground">${entry.label}</a></dt>
                                <dd class="mt-1 text-2xl font-semibold text-foreground">${entry.published}</dd>
                                ${entry.drafts ? html`<dd class="text-xs text-muted-foreground">${entry.drafts} ${entry.drafts === 1 ? __('draft') : __('drafts')}</dd>` : null}
                            </div>`)}
                            ${this.media >= 0 ? html`<div class="rounded-lg border border-border p-4"><dt class="text-sm text-muted-foreground"><a href="/dashboard/media" class="no-underline hover:text-foreground">${__('Media')}</a></dt>
                                <dd class="mt-1 text-2xl font-semibold text-foreground">${this.media}</dd></div>` : null}
                            ${this.users >= 0 ? html`<div class="rounded-lg border border-border p-4"><dt class="text-sm text-muted-foreground"><a href="/dashboard/users" class="no-underline hover:text-foreground">${__('Users')}</a></dt>
                                <dd class="mt-1 text-2xl font-semibold text-foreground">${this.users}</dd></div>` : null}
                        </dl>`)}
                    `)}
                    ${component(Card, {}, html`
                        ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Recently published')}</h2>`)}
                        ${component(CardBody, {}, list(this.published, __('Nothing published yet.')))}
                    `)}
                    ${widgets.length ? html`<section class="grid gap-4 sm:grid-cols-2">${widgets}</section>` : null}
                    ${this.canMigrate ? html`<dl class="grid grid-cols-2 gap-4">
                        <div class="rounded-lg border border-border p-4"><dt class="text-sm text-muted-foreground">${__('Events waiting for delivery')}</dt><dd class="text-2xl font-semibold text-foreground" data-testid="outbox">${this.outbox}</dd></div>
                        <div class="rounded-lg border border-border p-4"><dt class="text-sm text-muted-foreground">${__('Writes waiting for confirmation')}</dt><dd class="text-2xl font-semibold text-foreground">${this.unconfirmed}</dd></div>
                    </dl>` : null}
                </div>
                <div class="space-y-6">
                    ${this.canDraft ? component(Card, {}, html`
                        ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Quick draft')}</h2>`)}
                        ${component(CardBody, {}, html`<form class="space-y-3" @submit=${(event: Event) => this.saveQuickDraft(event)}>
                            ${component(Input, { 'aria-label': __('Title'), placeholder: __('Title'), '.value': this.quick.title, '@input': (event: Event) => { this.quick = { ...this.quick, title: (event.target as HTMLInputElement).value }; } })}
                            ${component(Textarea, { 'aria-label': __('Content'), placeholder: __("What's on your mind?"), rows: 4, '.value': this.quick.body, '@input': (event: Event) => { this.quick = { ...this.quick, body: (event.target as HTMLTextAreaElement).value }; } })}
                            ${component(Button, { type: 'submit', disabled: !this.quick.title.trim() }, __('Save draft'))}
                        </form>
                        <div class="mt-6 space-y-2"><h3 class="text-sm font-semibold text-foreground">${__('Your recent drafts')}</h3>${list(this.drafts, __('No drafts.'))}</div>`)}
                    `) : component(Card, {}, component(CardBody, {}, html`<p class="text-sm text-muted-foreground">${__('Manage your profile and sessions from the account menu.')}</p>
                        <div class="mt-3">${linkButton(__('Edit profile'), '/dashboard/profile', 'outline')}</div>`))}
                </div>
            </div>
        </div>`;
    }
}
