import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { AlertDialog, Button, Card, CardBody, Field, Icon, Input, NativeSelect, Textarea, toast } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, PERMISSIONS, slugify, type TermShape } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { icon } from '../../../../../cms/icons';
import { iconSelect } from '../../../../../cms/term-icons';
import { notice, pageHeader } from '../../../../../cms/ui';

interface Row { id: string; name: string; slug: string; description: string; icon: string; depth: number; count: number }
interface Draft { name: string; slug: string; parent: string; description: string; icon: string }

/** Terms of one taxonomy, WordPress style: an add form beside the table of terms with their counts. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageTerms)] })
export default class TermsPage extends Cossack {
    @State() taxonomy = { name: '', label: '', singular: '', hierarchical: false, path: '' as string | null };
    @State() rows: Row[] = [];
    @State() search = '';
    @State() draft: Draft = { name: '', slug: '', parent: '', description: '', icon: '' };
    /** The slug follows the name until it is typed. */
    @State() slugTouched = false;
    @State() errors: Record<string, string> = {};
    @State() error = '';
    @State() pendingDelete: Row | null = null;

    head(): HeadValue {
        return { title: this.taxonomy.label || __('Terms') };
    }

    async init() {
        this.search = (this.c.req.query('q') ?? '').slice(0, 100);
        await this.load();
    }

    @Server()
    async load() {
        const cms = this.c.get('cms');
        try {
            const declaration = cms.taxonomies.declaration(this.c.req.param('taxonomy') ?? '');
            this.taxonomy = { name: declaration.name, label: declaration.label, singular: declaration.singular, hierarchical: declaration.hierarchical, path: declaration.path ?? null };
        } catch { this.error = __('This taxonomy does not exist.'); this.c.status(404); return; }
        const terms: TermShape[] = this.search ? (await cms.taxonomies.list(this.taxonomy.name, { search: this.search, limit: 200 })).items : await cms.taxonomies.tree(this.taxonomy.name);
        const counts = await cms.taxonomies.counts(this.taxonomy.name, terms.map(term => term.id));
        this.rows = terms.map(term => ({ id: term.id, name: term.name, slug: term.slug, description: term.description, icon: term.icon, depth: this.search ? 0 : term.depth, count: counts.get(term.id) ?? 0 }));
    }

    @Client()
    setDraft(name: keyof Draft, value: string) {
        if (name === 'slug') this.slugTouched = value.trim() !== '';
        // The slug is generated from the name, as WordPress does, until it is edited.
        this.draft = { ...this.draft, [name]: value, ...(name === 'name' && !this.slugTouched ? { slug: slugify(value) } : {}) };
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.create(this.draft);
        if (!Object.keys(this.errors).length && !this.error) toast.success(`${this.taxonomy.singular} ${__('added.')}`);
    }

    @Server()
    async create(draft: Draft) {
        this.errors = {};
        this.error = '';
        try {
            const terms = this.c.get('cms').taxonomies;
            await terms.create(this.taxonomy.name, { name: draft.name, slug: draft.slug, description: draft.description, parent: draft.parent || null, icon: draft.icon }, { principal: this.c.get('principal') });
            this.draft = { name: '', slug: '', parent: '', description: '', icon: '' };
            this.slugTouched = false;
            await this.load();
        } catch (error) {
            this.errors = isCmsError(error) && error.fields ? { ...error.fields } : {};
            this.error = isCmsError(error) ? error.message : __('The term could not be added.');
        }
    }

    @Server()
    async remove(id: string) {
        this.error = '';
        try { await this.c.get('cms').taxonomies.delete(id, { principal: this.c.get('principal') }); }
        catch (error) { this.error = isCmsError(error) ? error.message : __('The term could not be deleted.'); }
        await this.load();
    }

    render() {
        if (!this.taxonomy.name) return notice(this.error || __('This taxonomy does not exist.'), 'error');
        const base = `/dashboard/terms/${this.taxonomy.name}`;
        return html`<div class="space-y-6">
            ${pageHeader(this.taxonomy.label, { description: this.taxonomy.hierarchical ? __('Nest terms to organize them; archives include the terms below.') : undefined })}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
                ${component(Card, {}, component(CardBody, {}, html`
                    <h2 class="mb-4 text-base font-semibold text-foreground">${__('Add new')} ${this.taxonomy.singular.toLowerCase()}</h2>
                    <form class="space-y-4" @submit=${(event: Event) => this.submit(event)}>
                        ${component(Field, { label: __('Name'), for: 'term-name', error: this.errors.name, hint: __('The name is how it appears on your site.'),
                            control: attributes => component(Input, { ...attributes, '.value': this.draft.name, '@input': (event: Event) => this.setDraft('name', (event.target as HTMLInputElement).value) }) })}
                        ${component(Field, { label: __('Slug'), for: 'term-slug', error: this.errors.slug, hint: __('Generated from the name; lowercase letters, digits and hyphens.'),
                            control: attributes => component(Input, { ...attributes, '.value': this.draft.slug, '@input': (event: Event) => this.setDraft('slug', (event.target as HTMLInputElement).value) }) })}
                        ${this.taxonomy.hierarchical ? component(Field, { label: __('Parent'), for: 'term-parent', error: this.errors.parent,
                            control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => this.setDraft('parent', (event.target as HTMLSelectElement).value) }, html`
                                <option value="" ?selected=${!this.draft.parent}>${__('None')}</option>
                                ${this.rows.map(row => html`<option value=${row.id} ?selected=${row.id === this.draft.parent}>${'— '.repeat(row.depth)}${row.name}</option>`)}`) }) : null}
                        ${component(Field, { label: __('Description'), for: 'term-description', error: this.errors.description,
                            control: attributes => component(Textarea, { ...attributes, rows: 3, '.value': this.draft.description, '@input': (event: Event) => this.setDraft('description', (event.target as HTMLTextAreaElement).value) }) })}
                        ${iconSelect('term-icon', this.draft.icon, value => this.setDraft('icon', value), this.errors.icon)}
                        ${component(Button, { type: 'submit', disabled: !this.draft.name.trim() }, `${__('Add new')} ${this.taxonomy.singular.toLowerCase()}`)}
                    </form>`))}
                <div class="space-y-3">
                    <form method="get" action=${base} class="flex justify-end gap-2" role="search">
                        ${component(Input, { type: 'search', name: 'q', size: 'sm', value: this.search, placeholder: `${__('Search')} ${this.taxonomy.label.toLowerCase()}`, 'aria-label': __('Search') })}
                        ${component(Button, { type: 'submit', size: 'sm', variant: 'outline' }, __('Search'))}
                    </form>
                    ${component(Card, {}, component(CardBody, { class: 'p-0' }, html`<div class="overflow-x-auto"><table class="w-full text-sm">
                        <thead><tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th class="px-4 py-3 font-medium">${__('Name')}</th><th class="px-4 py-3 font-medium">${__('Description')}</th>
                            <th class="px-4 py-3 font-medium">${__('Slug')}</th><th class="px-4 py-3 text-right font-medium">${__('Count')}</th>
                        </tr></thead>
                        <tbody>${this.rows.map(row => html`<tr class="group border-b border-border last:border-0 align-top">
                            <td class="px-4 py-3">
                                <a href=${`${base}/${row.id}`} class="inline-flex items-center gap-1.5 font-medium text-foreground hover:text-primary no-underline">${'— '.repeat(row.depth)}${row.icon ? html`<span class="inline-flex text-muted-foreground [&_svg]:size-4">${component(Icon, { entry: icon(row.icon), size: 16 })}</span>` : null}${row.name}</a>
                                <div class="mt-1 flex gap-2 text-xs opacity-80 group-hover:opacity-100">
                                    <a href=${`${base}/${row.id}`} class="text-primary hover:underline">${__('Edit')}</a><span aria-hidden="true" class="text-muted-foreground">|</span>
                                    <button type="button" class="text-destructive hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => { this.pendingDelete = row; }}>${__('Delete')}</button>
                                    ${this.taxonomy.path ? html`<span aria-hidden="true" class="text-muted-foreground">|</span><a href=${`/${this.taxonomy.path}/${row.slug}`} class="text-primary hover:underline">${__('View')}</a>` : null}
                                </div>
                            </td>
                            <td class="px-4 py-3 text-muted-foreground">${row.description || '—'}</td>
                            <td class="px-4 py-3 font-mono text-xs text-muted-foreground">${row.slug}</td>
                            <td class="px-4 py-3 text-right text-muted-foreground">${row.count}</td>
                        </tr>`)}</tbody>
                    </table>${this.rows.length ? null : html`<p class="px-4 py-10 text-center text-sm text-muted-foreground">${__('No terms found.')}</p>`}</div>`))}
                </div>
            </div>
            ${component(AlertDialog, {
                id: 'delete-term-dialog', open: this.pendingDelete !== null, title: `${__('Delete')} ${this.taxonomy.singular.toLowerCase()}?`,
                description: this.pendingDelete ? `“${this.pendingDelete.name}” ${__('is removed from entries. Terms below it move up a level.')}` : '',
                cancelLabel: __('Cancel'), actionLabel: __('Delete'), actionVariant: 'destructive',
                onAction: () => { const row = this.pendingDelete; this.pendingDelete = null; if (row) void this.remove(row.id); },
                onOpenChange: () => { this.pendingDelete = null; },
            })}
        </div>`;
    }
}
