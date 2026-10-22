import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, Icon, Input, Textarea, toast } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { plugins } from '@cossackframework/framework/plugins';
import { blockId, evaluateRule, hasPermission, isCmsError, PERMISSIONS, recordTitle, richTextFromPlain } from '@cossackframework/cms';
import { icon } from '../../cms/icons';
import { linkButton, notice, shortDate } from '../../cms/ui';
import { parseUserAgent } from '../../dashboard/session-list';

/** Components active plugins export as `slots['dashboard.overview']` from their ui.ts. */
function overviewWidgets(active: readonly string[]): TemplateResult[] {
    return plugins.filter(plugin => active.includes(plugin.name)).flatMap(plugin => {
        const slots = (plugin.ui as { slots?: Record<string, unknown[]> } | null)?.slots;
        return (slots?.['dashboard.overview'] ?? []).map(widget => component(widget as never, {}));
    });
}

interface Glance { label: string; href: string; icon: string; published: number; drafts: number }
interface Item { title: string; href: string; at: number; meta?: string }
/** A sign-in: the account and the device, from the session's user agent. */
interface SignIn { name: string; avatar: string | null; href: string; at: number; device: string; ip: string }

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
    /** Entries waiting for review, across collections, for editors. */
    @State() pending: Item[] = [];
    @State() pendingTotal = 0;
    /** Who signed in lately, for user managers. */
    @State() signIns: SignIn[] = [];
    @State() canSeeSignIns = false;
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
            glance.push({ label: collection.label, href: `/dashboard/content/${collection.name}`, icon: collection.icon ?? 'document-text', published: counts[0]!, drafts: counts[1]! });
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
        // The newest published entries of every publishable collection, together.
        const recent: Item[] = [];
        for (const collection of cms.collections()) {
            if (collection.publishable === false || collection.name === 'forms') continue;
            const page = await cms.resource(`cms/${collection.name}`).list({ where: { status: 'published' }, order: { field: 'publishedAt', direction: 'desc' }, limit: 5 }, context).catch(() => ({ records: [] }));
            recent.push(...page.records.map(record => ({ title: recordTitle(record, 'title'), href: `/dashboard/content/${collection.name}/${record.id}`, at: Number(record.publishedAt), meta: collection.singular })));
        }
        this.published = recent.sort((a, b) => b.at - a.at).slice(0, 8);
        const status = await cms.status();
        this.canMigrate = hasPermission(principal, PERMISSIONS.manageSchema);
        // Comments and reviews waiting for someone.
        const waiting: { text: string; href: string }[] = [];
        if (hasPermission(principal, PERMISSIONS.moderateComments)) {
            const pending = await cms.comments.counts().then(counts => counts.pending).catch(() => 0);
            if (pending) waiting.push({ text: `${pending} ${pending === 1 ? __('comment is waiting for moderation.') : __('comments are waiting for moderation.')}`, href: '/dashboard/comments?status=pending' });
        }
        // Entries waiting for review get their own card; the notice stays for the count.
        const pending: Item[] = [];
        let pendingTotal = 0;
        for (const collection of cms.collections()) {
            if (collection.publishable === false || !hasPermission(principal, `cms/${collection.name}:update`)) continue;
            const repository = cms.resource(`cms/${collection.name}`);
            const count = await repository.count({ where: { status: 'pending' } }, context).catch(() => 0);
            if (!count) continue;
            pendingTotal += count;
            const page = await repository.list({ where: { status: 'pending' }, order: { field: 'updatedAt', direction: 'desc' }, limit: 5 }, context).catch(() => ({ records: [] }));
            const owners = await cms.users.getMany(page.records.map(record => record.owner).filter((owner): owner is string => !!owner));
            pending.push(...page.records.map(record => ({ title: recordTitle(record, 'title'), href: `/dashboard/content/${collection.name}/${record.id}`, at: record.updatedAt,
                meta: [collection.singular, record.owner ? owners.get(record.owner)?.name : ''].filter(Boolean).join(' · ') })));
        }
        this.pending = pending.sort((a, b) => b.at - a.at).slice(0, 8);
        this.pendingTotal = pendingTotal;
        if (pendingTotal) waiting.push({ text: `${pendingTotal} ${pendingTotal === 1 ? __('entry is pending review.') : __('entries are pending review.')}`, href: '#pending-review' });
        // Who signed in lately: sessions end at sign-out, so these are the accounts signed in now.
        this.canSeeSignIns = hasPermission(principal, PERMISSIONS.manageUsers);
        if (this.canSeeSignIns) {
            const sessions = await cms.authSessions.listRecent(Date.now(), 8).catch(() => []);
            const users = await cms.users.getMany([...new Set(sessions.map(session => session.userId))]);
            this.signIns = sessions.map(session => {
                const user = users.get(session.userId);
                const agent = parseUserAgent(session.userAgent);
                return { name: user?.name || user?.email || __('Deleted user'), avatar: user?.avatar ?? null, href: user ? `/dashboard/users/${user.id}?tab=sessions` : '/dashboard/users',
                    at: session.createdAt, device: session.userAgent ? `${agent.browser} · ${agent.os}` : __('Unknown device'), ip: session.ip ?? '' };
            });
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
            // The text becomes the post's first Rich text block.
            await this.c.get('cms').resource('cms/posts').create({ title, content: body.trim() ? [{ id: blockId(), type: 'core/richtext', data: { text: richTextFromPlain(body) } }] : [], status: 'draft' }, { principal: this.c.get('principal') });
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
                <span class="min-w-0 truncate"><a href=${item.href} class="text-primary hover:underline">${item.title}</a>${item.meta ? html`<span class="ml-2 text-xs text-muted-foreground">${item.meta}</span>` : null}</span>
                <span class="shrink-0 text-xs text-muted-foreground">${shortDate(item.at)}</span></li>`)}</ul>`
            : html`<p class="text-sm text-muted-foreground">${empty}</p>`;
        const heading = (title: string, extra: TemplateResult | null = null) => component(CardHeader, {}, html`<div class="flex items-center justify-between gap-3"><h2 class="text-base font-semibold text-foreground">${title}</h2>${extra}</div>`);
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
                        ${heading(__('At a glance'))}
                        ${component(CardBody, {}, html`<dl class="grid grid-cols-2 gap-4 sm:grid-cols-3">
                            ${[...this.glance.map(entry => ({ ...entry, note: entry.drafts ? `${entry.drafts} ${entry.drafts === 1 ? __('draft') : __('drafts')}` : '' })),
                                ...(this.media >= 0 ? [{ label: __('Media'), href: '/dashboard/media', icon: 'gallery', published: this.media, note: '' }] : []),
                                ...(this.users >= 0 ? [{ label: __('Users'), href: '/dashboard/users', icon: 'users-group-rounded', published: this.users, note: '' }] : [])]
                            .map(entry => html`<a href=${entry.href} class="group rounded-lg border border-border p-4 no-underline transition-colors hover:border-primary/50 hover:bg-muted/40">
                                <dt class="flex items-center gap-2 text-sm text-muted-foreground group-hover:text-foreground"><span class="inline-flex [&_svg]:size-4">${component(Icon, { entry: icon(entry.icon), size: 16 })}</span>${entry.label}</dt>
                                <dd class="mt-1 text-2xl font-semibold text-foreground">${entry.published}</dd>
                                ${entry.note ? html`<dd class="text-xs text-muted-foreground">${entry.note}</dd>` : null}
                            </a>`)}
                        </dl>`)}
                    `)}
                    ${this.pendingTotal ? html`<div id="pending-review">${component(Card, {}, html`
                        ${heading(__('Waiting for review'), component(Badge, { variant: 'warning' }, String(this.pendingTotal)))}
                        ${component(CardBody, {}, html`${list(this.pending, '')}
                            ${this.pendingTotal > this.pending.length ? html`<p class="mt-3 text-xs"><a href="/dashboard/content/posts?status=pending" class="text-primary hover:underline">${__('Show everything pending')}</a></p>` : null}`)}
                    `)}</div>` : null}
                    ${component(Card, {}, html`
                        ${heading(__('Recently published'))}
                        ${component(CardBody, {}, list(this.published, __('Nothing published yet.')))}
                    `)}
                    ${this.canSeeSignIns ? component(Card, {}, html`
                        ${heading(__('Recent sign-ins'), html`<a href="/dashboard/users" class="text-xs text-primary hover:underline">${__('All users')}</a>`)}
                        ${component(CardBody, {}, this.signIns.length ? html`<ul class="divide-y divide-border">${this.signIns.map(entry => html`<li class="flex items-center gap-3 py-2 text-sm first:pt-0 last:pb-0">
                            ${component(Avatar, { src: entry.avatar ?? undefined, alt: entry.name, size: 28 })}
                            <span class="min-w-0 flex-1"><a href=${entry.href} class="block truncate font-medium text-foreground no-underline hover:text-primary">${entry.name}</a>
                                <span class="block truncate text-xs text-muted-foreground">${entry.device}${entry.ip ? ` · ${entry.ip}` : ''}</span></span>
                            <span class="shrink-0 text-xs text-muted-foreground">${shortDate(entry.at)}</span></li>`)}</ul>`
                            : html`<p class="text-sm text-muted-foreground">${__('No one is signed in.')}</p>`)}
                    `) : null}
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
