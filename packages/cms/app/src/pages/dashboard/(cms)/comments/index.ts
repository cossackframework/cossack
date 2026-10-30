import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Avatar, Badge, Button, Card, CardBody, Checkbox, Input, NativeSelect, Pagination, Textarea, toast } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { COMMENT_STATUSES, isCmsError, PERMISSIONS, recordTitle, type CommentStatus } from '@cossackframework/cms';
import { requireAny } from '../../../../cms/guards';
import { notice, pageHeader, shortDate } from '../../../../cms/ui';

const PAGE_SIZE = 20;

interface Row {
    id: string;
    status: CommentStatus;
    author: string;
    email: string;
    url: string;
    avatar: string | null;
    content: string;
    date: string;
    entry: { title: string; edit: string; view: string | null } | null;
    parentAuthor: string;
    collection: string;
    entryId: string;
}

/**
 * Comments, as in WordPress: status tabs with counts, approve, reply, edit, spam and trash,
 * one at a time or in bulk. Moderators' replies appear at once.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.moderateComments)] })
export default class CommentsPage extends Cossack {
    @State() status: 'all' | CommentStatus = 'all';
    @State() counts: Record<string, number> = {};
    @State() rows: Row[] = [];
    @State() total = 0;
    @State() page = 1;
    @State() search = '';
    @State() entryFilter = { collection: '', entry: '', title: '' };
    @State() selected: string[] = [];
    @State() bulk = '';
    @State() replying = '';
    @State() replyText = '';
    @State() editing: { id: string; content: string; authorName: string; authorEmail: string; authorUrl: string } | null = null;
    @State() error = '';
    /** Settings → Discussion → Allow discussions; off hides comments on the site, and they can still be moderated here. */
    @State() discussions = true;

    head(): HeadValue {
        return { title: __('Comments') };
    }

    async init() {
        this.discussions = await this.c.get('cms').settings.get('discussion.enabled');
        const status = this.c.req.query('status') as CommentStatus | undefined;
        this.status = status && COMMENT_STATUSES.includes(status) ? status : 'all';
        this.search = (this.c.req.query('q') ?? '').slice(0, 100);
        this.entryFilter = { collection: this.c.req.query('collection') ?? '', entry: this.c.req.query('entry') ?? '', title: '' };
        const page = Number(this.c.req.query('page'));
        this.page = Number.isSafeInteger(page) && page > 0 ? page : 1;
        await this.load();
    }

    @Server()
    private async load() {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const counts = await cms.comments.counts();
        this.counts = { ...counts, all: counts.pending + counts.approved };
        const resource = this.entryFilter.collection ? `cms/${this.entryFilter.collection}` : undefined;
        const result = await cms.comments.list({
            ...(this.status === 'all' ? {} : { status: this.status }), ...(this.search ? { search: this.search } : {}),
            ...(resource && this.entryFilter.entry ? { resource, recordId: this.entryFilter.entry } : {}),
            offset: (this.page - 1) * PAGE_SIZE, limit: PAGE_SIZE,
        });
        this.total = result.total;
        // Entry titles and links, one read per collection.
        const entries = new Map<string, { title: string; edit: string; view: string | null }>();
        for (const name of new Set(result.items.map(item => item.resource))) {
            if (!name.startsWith('cms/')) continue;
            try {
                const collection = cms.collection(name.slice(4));
                const records = await cms.resource(name).getMany(result.items.filter(item => item.resource === name).map(item => item.recordId), { principal });
                const urls = await cms.entryUrls(collection, [...records.values()]);
                for (const record of records.values()) entries.set(`${name}:${record.id}`, { title: recordTitle(record, 'title'), edit: `/dashboard/content/${collection.name}/${record.id}`, view: record.status === 'published' ? urls.get(record.id) ?? null : null });
            } catch (error) { if (!isCmsError(error)) throw error; }
        }
        if (resource && this.entryFilter.entry) this.entryFilter = { ...this.entryFilter, title: entries.get(`${resource}:${this.entryFilter.entry}`)?.title ?? '' };
        const users = await cms.users.getMany(result.items.map(item => item.userId).filter((id): id is string => !!id));
        const parents = await Promise.all(result.items.map(item => item.parentId ? cms.comments.get(item.parentId) : null));
        this.rows = result.items.map((item, index) => ({
            id: item.id, status: item.status, author: item.authorName || __('Anonymous'), email: item.authorEmail, url: item.authorUrl,
            avatar: item.userId ? users.get(item.userId)?.avatar ?? null : null, content: item.content, date: shortDate(item.createdAt),
            entry: entries.get(`${item.resource}:${item.recordId}`) ?? null, parentAuthor: parents[index]?.authorName ?? '',
            collection: item.resource.slice(4), entryId: item.recordId,
        }));
        this.selected = [];
    }

    @Server()
    async moderate(ids: string[], status: CommentStatus | 'delete') {
        this.error = '';
        try {
            await this.c.get('cms').moderateComments(ids, status, this.c.get('principal'));
        } catch (error) { this.error = isCmsError(error) ? error.message : __('The comments could not be changed.'); }
        await this.load();
    }

    @Client()
    async applyBulk() {
        if (!this.bulk || !this.selected.length) return;
        await this.moderate(this.selected, this.bulk as CommentStatus | 'delete');
        this.bulk = '';
    }

    @Server()
    async reply(row: Row, content: string) {
        this.error = '';
        try {
            await this.c.get('cms').postComment({ collection: row.collection, entry: row.entryId, parent: row.id, content }, { principal: this.c.get('principal') });
            this.replying = '';
            this.replyText = '';
        } catch (error) { this.error = isCmsError(error) ? error.message : __('The reply could not be posted.'); }
        await this.load();
    }

    @Client()
    async sendReply(row: Row) {
        await this.reply(row, this.replyText);
        if (this.error) toast.error(this.error); else toast.success(__('Reply posted.'));
    }

    @Server()
    async saveEdit(edit: { id: string; content: string; authorName: string; authorEmail: string; authorUrl: string }) {
        this.error = '';
        try {
            const { comments } = this.c.get('cms');
            await comments.update(edit.id, { content: edit.content, authorName: edit.authorName, authorEmail: edit.authorEmail, authorUrl: edit.authorUrl });
            this.editing = null;
        } catch (error) { this.error = isCmsError(error) ? error.message : __('The comment could not be saved.'); }
        await this.load();
    }

    @Client()
    toggle(id: string, checked: boolean) {
        this.selected = checked ? [...new Set([...this.selected, id])] : this.selected.filter(entry => entry !== id);
    }

    private href(changes: Record<string, string | number>) {
        const next = { status: this.status === 'all' ? '' : this.status, q: this.search, collection: this.entryFilter.collection, entry: this.entryFilter.entry, page: this.page, ...changes };
        const params = new URLSearchParams(Object.entries(next).filter(([key, value]) => value && !(key === 'page' && Number(value) <= 1)).map(([key, value]) => [key, String(value)]));
        return `/dashboard/comments${params.size ? `?${params}` : ''}`;
    }

    private actions(row: Row): TemplateResult {
        const action = (label: string, run: () => void, danger = false) => html`<button type="button" class=${`bg-transparent border-none p-0 cursor-pointer hover:underline ${danger ? 'text-destructive' : 'text-primary'}`} @click=${run}>${label}</button>`;
        const set = (status: CommentStatus | 'delete') => () => this.moderate([row.id], status);
        const items = row.status === 'trash' || row.status === 'spam'
            ? [action(row.status === 'spam' ? __('Not spam') : __('Restore'), set('pending')), action(__('Delete permanently'), set('delete'), true)]
            : [row.status === 'pending' ? action(__('Approve'), set('approved')) : action(__('Unapprove'), set('pending')),
                ...(row.status === 'approved' ? [action(__('Reply'), () => { this.replying = row.id; this.replyText = ''; })] : []),
                action(__('Edit'), () => { this.editing = { id: row.id, content: row.content, authorName: row.author, authorEmail: row.email, authorUrl: row.url }; }),
                action(__('Spam'), set('spam'), true), action(__('Trash'), set('trash'), true)];
        return html`<div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">${items}</div>`;
    }

    private row(row: Row): TemplateResult {
        const editing = this.editing?.id === row.id ? this.editing : null;
        return html`<tr class=${`border-b border-border last:border-0 align-top ${row.status === 'pending' ? 'bg-amber-500/5' : ''}`} data-comment=${row.id} data-status=${row.status}>
            <td class="px-3 py-2">${component(Checkbox, { checked: this.selected.includes(row.id), 'aria-label': `${__('Select comment by')} ${row.author}`, '@change': (event: Event) => this.toggle(row.id, (event.target as HTMLInputElement).checked) })}</td>
            <td class="px-3 py-2"><span class="flex items-start gap-2">${component(Avatar, { src: row.avatar ?? undefined, alt: row.author, size: 32 })}
                <span class="min-w-0"><span class="block font-medium text-foreground">${row.author}</span>
                    ${row.email ? html`<a href=${`mailto:${row.email}`} class="block truncate text-xs text-primary hover:underline">${row.email}</a>` : null}
                    ${row.url ? html`<span class="block truncate text-xs text-muted-foreground">${row.url}</span>` : null}</span></span></td>
            <td class="max-w-xl px-3 py-2">
                ${row.status !== 'approved' ? html`<span class="mb-1 inline-block">${component(Badge, { variant: row.status === 'pending' ? 'warning' : row.status === 'spam' ? 'destructive' : 'secondary' },
                    row.status === 'pending' ? __('Pending') : row.status === 'spam' ? __('Spam') : __('Trash'))}</span>` : null}
                ${row.parentAuthor ? html`<p class="text-xs text-muted-foreground">${__('In reply to')} ${row.parentAuthor}</p>` : null}
                ${editing ? html`<form class="space-y-2" @submit=${(event: Event) => { event.preventDefault(); void this.saveEdit(editing); }}>
                    <div class="grid gap-2 sm:grid-cols-3">
                        ${component(Input, { size: 'sm', 'aria-label': __('Name'), '.value': editing.authorName, '@input': (event: Event) => { this.editing = { ...editing, authorName: (event.target as HTMLInputElement).value }; } })}
                        ${component(Input, { size: 'sm', type: 'email', 'aria-label': __('Email'), '.value': editing.authorEmail, '@input': (event: Event) => { this.editing = { ...editing, authorEmail: (event.target as HTMLInputElement).value }; } })}
                        ${component(Input, { size: 'sm', 'aria-label': __('Website'), '.value': editing.authorUrl, '@input': (event: Event) => { this.editing = { ...editing, authorUrl: (event.target as HTMLInputElement).value }; } })}
                    </div>
                    ${component(Textarea, { rows: 4, 'aria-label': __('Comment'), '.value': editing.content, '@input': (event: Event) => { this.editing = { ...editing, content: (event.target as HTMLTextAreaElement).value }; } })}
                    <div class="flex gap-2">${component(Button, { type: 'submit', size: 'sm' }, __('Update comment'))}${component(Button, { type: 'button', size: 'sm', variant: 'ghost', '@click': () => { this.editing = null; } }, __('Cancel'))}</div>
                </form>` : html`<p class="whitespace-pre-wrap break-words text-sm text-foreground">${row.content}</p>${this.actions(row)}`}
                ${this.replying === row.id ? html`<form class="mt-3 space-y-2" @submit=${(event: Event) => { event.preventDefault(); void this.sendReply(row); }}>
                    ${component(Textarea, { rows: 3, 'aria-label': __('Reply'), '.value': this.replyText, '@input': (event: Event) => { this.replyText = (event.target as HTMLTextAreaElement).value; } })}
                    <div class="flex gap-2">${component(Button, { type: 'submit', size: 'sm', disabled: !this.replyText.trim() }, __('Reply'))}${component(Button, { type: 'button', size: 'sm', variant: 'ghost', '@click': () => { this.replying = ''; } }, __('Cancel'))}</div>
                </form>` : null}
            </td>
            <td class="px-3 py-2">${row.entry ? html`<a href=${row.entry.edit} class="font-medium text-foreground hover:text-primary">${row.entry.title}</a>
                ${row.entry.view ? html`<a href=${`${row.entry.view}#comment-${row.id}`} class="block text-xs text-primary hover:underline">${__('View')}</a>` : null}
                <a href=${this.href({ collection: row.collection, entry: row.entryId, page: 1 })} class="block text-xs text-muted-foreground hover:text-foreground">${__('All comments on it')}</a>` : html`<span class="text-muted-foreground">—</span>`}</td>
            <td class="px-3 py-2 text-xs text-muted-foreground">${row.date}</td>
        </tr>`;
    }

    render() {
        const tabs: [string, string][] = [['all', __('All')], ['pending', __('Pending')], ['approved', __('Approved')], ['spam', __('Spam')], ['trash', __('Trash')]];
        const totalPages = Math.max(1, Math.ceil(this.total / PAGE_SIZE));
        return html`<div class="space-y-6">
            ${pageHeader(this.entryFilter.title ? `${__('Comments on')} “${this.entryFilter.title}”` : __('Comments'))}
            ${this.discussions ? null : notice(__('Discussions are turned off: the site shows no comments and takes no new ones. Turn them on under Settings → Discussion.'))}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <nav aria-label=${__('Filter by status')} class="flex flex-wrap gap-x-3 gap-y-1 text-sm">${tabs.map(([key, label], index) => html`${index ? html`<span class="text-muted-foreground" aria-hidden="true">|</span>` : null}
                    <a href=${this.href({ status: key === 'all' ? '' : key, page: 1 })} aria-current=${this.status === key ? 'page' : 'false'}
                        class=${this.status === key ? 'font-semibold text-foreground no-underline' : 'text-primary no-underline hover:underline'}>${label} <span class="text-muted-foreground">(${this.counts[key] ?? 0})</span></a>`)}</nav>
                <form method="get" class="flex gap-2" role="search">
                    ${this.status !== 'all' ? html`<input type="hidden" name="status" value=${this.status}>` : null}
                    ${component(Input, { type: 'search', name: 'q', size: 'sm', value: this.search, placeholder: __('Search comments'), 'aria-label': __('Search comments') })}
                    ${component(Button, { type: 'submit', size: 'sm', variant: 'outline' }, __('Search'))}
                </form>
            </div>
            <div class="flex items-center gap-2">
                ${component(NativeSelect, { size: 'sm', 'aria-label': __('Bulk actions'), '@change': (event: Event) => { this.bulk = (event.target as HTMLSelectElement).value; } }, html`
                    <option value="" ?selected=${!this.bulk}>${__('Bulk actions')}</option>
                    ${this.status === 'trash' || this.status === 'spam' ? html`<option value="pending">${__('Restore')}</option><option value="delete">${__('Delete permanently')}</option>`
                        : html`<option value="approved">${__('Approve')}</option><option value="pending">${__('Unapprove')}</option><option value="spam">${__('Mark as spam')}</option><option value="trash">${__('Move to trash')}</option>`}`)}
                ${component(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: !this.bulk || !this.selected.length, '@click': () => this.applyBulk() }, __('Apply'))}
                ${this.entryFilter.entry ? html`<a href="/dashboard/comments" class="ml-auto text-sm text-primary hover:underline">${__('Show all comments')}</a>` : null}
            </div>
            ${component(Card, {}, component(CardBody, { class: 'p-0' }, html`<div class="overflow-x-auto"><table class="w-full text-sm">
                <thead><tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th class="w-10 px-3 py-2"><span class="sr-only">${__('Select')}</span></th><th class="px-3 py-2 font-medium">${__('Author')}</th><th class="px-3 py-2 font-medium">${__('Comment')}</th>
                    <th class="px-3 py-2 font-medium">${__('In response to')}</th><th class="px-3 py-2 font-medium">${__('Submitted on')}</th>
                </tr></thead>
                <tbody>${this.rows.map(row => this.row(row))}</tbody></table>
                ${this.rows.length ? null : html`<p class="px-4 py-10 text-center text-sm text-muted-foreground">${__('No comments found.')}</p>`}</div>`))}
            ${totalPages > 1 ? component(Pagination, { page: this.page, totalPages, label: __('Pagination'), previousLabel: __('Previous page'), nextLabel: __('Next page'),
                pageLabel: (page: number) => `${__('Page')} ${page}`, href: (page: number) => this.href({ page }) }) : null}
        </div>`;
    }
}
