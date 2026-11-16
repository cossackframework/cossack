import { Client, Cossack, Page, Server, State, type HeadValue } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Textarea } from '@cossackframework/ui';
import { notice, pageHeader } from '@cossackframework/ui/blocks';
import { isCmsError, type RecordShape } from '@cossackframework/cms';

interface Bookmark { id: string; rev: number; title: string; url: string; note: string; done: boolean }
interface Draft { title: string; url: string; note: string }

const STATUSES = ['draft', 'pending', 'scheduled', 'published'] as const;
const EMPTY: Draft = { title: '', url: '', note: '' };

/**
 * The plugin's screen at /dashboard/example, which the manifest's `ui.slots['dashboard.nav']`
 * links from the navigation. It reads and writes through the host as the signed-in user:
 * `pluginCms('example')` gives the plugin's own records and the ones it is granted (posts, to
 * read), and every call is authorized for the principal passed in. The route answers only
 * while the plugin is active.
 */
@Page({ transport: 'http' })
export default class ExampleScreen extends Cossack {
    @State() bookmarks: Bookmark[] = [];
    /** Posts by status, or null when the plugin or the user may not read posts. */
    @State() posts: { status: string; count: number }[] | null = null;
    @State() draft: Draft = { ...EMPTY };
    @State() error = '';
    @State() message = '';

    head(): HeadValue {
        return { title: 'Example' };
    }

    async init() {
        // The "Add to reading list" quick action under entries opens this screen with the entry's title and address.
        this.draft = { title: this.c.req.query('title') ?? '', url: this.c.req.query('url') ?? '', note: '' };
        await this.load();
    }

    @Server()
    async load() {
        const cms = this.c.get('cms').pluginCms('example');
        const principal = this.c.get('principal');
        const page = await cms.resource('example/bookmarks').list({ order: { field: 'createdAt', direction: 'desc' }, limit: 50 }, { principal });
        this.bookmarks = page.records.map(bookmarkOf);
        try {
            const posts = cms.resource('cms/posts');
            this.posts = await Promise.all(STATUSES.map(async status => ({ status, count: await posts.count({ where: { status } }, { principal }) })));
        } catch (error) {
            if (!isCmsError(error)) throw error;
            this.posts = null;
        }
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.add(this.draft);
    }

    @Server()
    async add(draft: Draft) {
        await this.attempt('Added to the reading list.', async principal => {
            await this.c.get('cms').pluginCms('example').resource('example/bookmarks').create({ title: draft.title, url: draft.url, note: draft.note }, { principal });
            this.draft = { ...EMPTY };
        });
    }

    @Server()
    async setDone(id: string, rev: number, done: boolean) {
        await this.attempt('', principal => this.c.get('cms').pluginCms('example').resource('example/bookmarks').update(id, { done }, { principal, expectedRevision: rev }));
    }

    @Server()
    async remove(id: string, rev: number) {
        await this.attempt('Removed from the reading list.', principal => this.c.get('cms').pluginCms('example').resource('example/bookmarks').delete(id, { principal, expectedRevision: rev }));
    }

    /** Run a write as the signed-in user; a refusal, such as the plugin's own address check, shows as the screen's error. */
    private async attempt(success: string, write: (principal: ReturnType<typeof this.c.get<'principal'>>) => Promise<unknown>): Promise<void> {
        this.error = '';
        this.message = '';
        try {
            await write(this.c.get('principal'));
            this.message = success;
        } catch (error) {
            if (!isCmsError(error)) throw error;
            this.error = error.message;
        }
        await this.load();
    }

    render() {
        const set = (key: keyof Draft) => (event: Event) => { this.draft = { ...this.draft, [key]: (event.target as HTMLInputElement).value }; };
        return html`<div class="space-y-6" data-testid="example-screen">
            ${pageHeader('Example', { description: "A plugin's own screen: a reading list kept in the plugin's records, and posts counted through its grant." })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">Reading list</h2>
                        <p class="text-sm text-muted-foreground">Records of the plugin's own resource, <code>example/bookmarks</code>. Everyone signed in sees them; their owners change them.</p>`)}
                    ${component(CardBody, { class: 'p-0' }, this.bookmarks.length ? html`<ul class="divide-y divide-border" data-testid="example-bookmarks">${this.bookmarks.map(item => html`
                        <li class="flex items-start gap-3 px-6 py-3" data-bookmark=${item.id}>
                            <span class="pt-0.5">${component(Checkbox, { checked: item.done, 'aria-label': `${item.title}: read`, '@change': (event: Event) => this.setDone(item.id, item.rev, (event.target as HTMLInputElement).checked) })}</span>
                            <span class="min-w-0 flex-1">
                                <a href=${item.url} class=${`block truncate text-sm font-medium no-underline hover:text-primary ${item.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>${item.title}</a>
                                <span class="block truncate text-xs text-muted-foreground">${item.url}</span>
                                ${item.note ? html`<span class="mt-1 block text-sm text-muted-foreground">${item.note}</span>` : null}
                            </span>
                            ${component(Button, { type: 'button', size: 'sm', variant: 'ghost', '@click': () => this.remove(item.id, item.rev) }, 'Remove')}
                        </li>`)}</ul>`
                        : html`<p class="px-6 pb-6 text-sm text-muted-foreground">Nothing yet. Add an address on the right, or use "Add to reading list" under any entry.</p>`)}`)}
                <div class="space-y-6">
                    ${component(Card, {}, html`
                        ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">Add to the reading list</h2>`)}
                        ${component(CardBody, {}, html`<form class="space-y-4" @submit=${(event: Event) => this.submit(event)}>
                            ${component(Field, { label: 'Title', for: 'example-title', required: true, control: attributes => component(Input, { ...attributes, maxlength: 120, '.value': this.draft.title, '@input': set('title') }) })}
                            ${component(Field, { label: 'Address', for: 'example-url', required: true, hint: 'https://…, or a path on this site such as /dashboard/content/posts.',
                                control: attributes => component(Input, { ...attributes, '.value': this.draft.url, '@input': set('url') }) })}
                            ${component(Field, { label: 'Note', for: 'example-note', control: attributes => component(Textarea, { ...attributes, rows: 3, maxlength: 2000, '.value': this.draft.note, '@input': set('note') }) })}
                            <div>${component(Button, { type: 'submit' }, 'Add')}</div>
                        </form>`)}`)}
                    ${component(Card, {}, html`
                        ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">Posts by status</h2>
                            <p class="text-sm text-muted-foreground">Counted through the plugin's grant to read <code>cms/posts</code>, as you.</p>`)}
                        ${component(CardBody, {}, this.posts ? html`<dl class="grid grid-cols-2 gap-3" data-testid="example-posts">${this.posts.map(entry => html`
                            <div class="rounded-lg border border-border p-3"><dt class="text-xs capitalize text-muted-foreground">${entry.status}</dt><dd class="text-xl font-semibold text-foreground">${entry.count}</dd></div>`)}</dl>`
                            : html`<p class="text-sm text-muted-foreground">You, or the plugin, may not read posts.</p>`)}`)}
                </div>
            </div>
        </div>`;
    }
}

function bookmarkOf(record: RecordShape): Bookmark {
    return { id: record.id, rev: record.rev, title: String(record.title ?? ''), url: String(record.url ?? ''), note: String(record.note ?? ''), done: record.done === true };
}
