import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Badge, Button, Card, CardBody, Checkbox, Field, Input } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, PERMISSIONS } from '@cossackframework/cms';
import { fieldName } from '../../../../cms/builder';
import { requireAny } from '../../../../cms/guards';
import { notice, pageHeader } from '../../../../cms/ui';

interface Row { name: string; label: string; hierarchical: boolean; builtin: boolean; path: string | null; collections: string[]; terms: number }

/** Taxonomies: vocabularies such as categories and tags that collections use to group entries. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageCollections)] })
export default class TaxonomiesPage extends Cossack {
    @State() rows: Row[] = [];
    @State() draft = { label: '', singular: '', hierarchical: false, path: '' };
    @State() error = '';

    head(): HeadValue {
        return { title: 'Taxonomies' };
    }

    async init() {
        await this.load();
    }

    @Server()
    async load() {
        const cms = this.c.get('cms');
        const collections = cms.collections();
        this.rows = await Promise.all(cms.taxonomies.declarations.map(async taxonomy => ({
            name: taxonomy.name, label: taxonomy.label, hierarchical: taxonomy.hierarchical, builtin: taxonomy.builtin === true, path: taxonomy.path ?? null,
            collections: collections.filter(collection => collection.taxonomies?.includes(taxonomy.name)).map(collection => collection.label),
            terms: (await cms.taxonomies.list(taxonomy.name, { limit: 1 })).total,
        })));
    }

    @Client()
    setDraft<K extends keyof TaxonomiesPage['draft']>(key: K, value: TaxonomiesPage['draft'][K]) {
        this.draft = { ...this.draft, [key]: value };
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.create(this.draft);
    }

    @Server()
    async create(draft: TaxonomiesPage['draft']) {
        this.error = '';
        try {
            const name = fieldName(draft.label);
            const cms = this.c.get('cms');
            await cms.saveTaxonomy({ name, label: draft.label.trim(), singular: draft.singular.trim() || draft.label.trim(), hierarchical: draft.hierarchical,
                path: draft.path.trim() || null }, this.c.get('principal'));
            this.draft = { label: '', singular: '', hierarchical: false, path: '' };
            await this.load();
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The taxonomy could not be created.');
        }
    }

    render() {
        return html`<div class="space-y-6">
            ${pageHeader(__('Taxonomies'), { description: __('Group entries by terms. Choose which collections use a taxonomy on the collection.') })}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
                ${component(Card, {}, component(CardBody, { class: 'p-0' }, html`<table class="w-full text-sm">
                    <thead><tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th class="px-4 py-3 font-medium">${__('Taxonomy')}</th><th class="px-4 py-3 font-medium">${__('Used by')}</th>
                        <th class="px-4 py-3 font-medium">${__('URL')}</th><th class="px-4 py-3 text-right font-medium">${__('Terms')}</th>
                    </tr></thead>
                    <tbody>${this.rows.map(row => html`<tr class="border-b border-border last:border-0">
                        <td class="px-4 py-3">
                            <a href=${`/dashboard/taxonomies/${row.name}`} class="font-medium text-foreground hover:text-primary no-underline">${row.label}</a>
                            <span class="ml-2 inline-flex gap-1">${row.hierarchical ? component(Badge, { variant: 'outline' }, __('Nested')) : null}${row.builtin ? component(Badge, { variant: 'secondary' }, __('Built in')) : null}</span>
                            <div class="mt-1 text-xs"><a href=${`/dashboard/terms/${row.name}`} class="text-primary hover:underline">${__('Manage terms')}</a></div>
                        </td>
                        <td class="px-4 py-3 text-muted-foreground">${row.collections.join(', ') || '—'}</td>
                        <td class="px-4 py-3 font-mono text-xs text-muted-foreground">${row.path ? `/${row.path}/…` : '—'}</td>
                        <td class="px-4 py-3 text-right text-muted-foreground">${row.terms}</td>
                    </tr>`)}</tbody>
                </table>`))}
                ${component(Card, {}, component(CardBody, {}, html`
                    <h2 class="mb-4 text-base font-semibold text-foreground">${__('Add taxonomy')}</h2>
                    <form class="space-y-4" @submit=${(event: Event) => this.submit(event)}>
                        ${component(Field, { label: __('Plural name'), for: 'taxonomy-label', hint: this.draft.label ? `${__('Stored as')} ${fieldName(this.draft.label)}` : __('Such as Brands or Genres.'),
                            control: attributes => component(Input, { ...attributes, '.value': this.draft.label, '@input': (event: Event) => this.setDraft('label', (event.target as HTMLInputElement).value) }) })}
                        ${component(Field, { label: __('Singular name'), for: 'taxonomy-singular',
                            control: attributes => component(Input, { ...attributes, '.value': this.draft.singular, '@input': (event: Event) => this.setDraft('singular', (event.target as HTMLInputElement).value) }) })}
                        ${component(Field, { label: __('URL path'), for: 'taxonomy-path', hint: __('Archives at /<path>/<term>. Empty keeps them off the site.'),
                            control: attributes => component(Input, { ...attributes, '.value': this.draft.path, '@input': (event: Event) => this.setDraft('path', (event.target as HTMLInputElement).value) }) })}
                        <label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                            ${component(Checkbox, { checked: this.draft.hierarchical, '@change': (event: Event) => this.setDraft('hierarchical', (event.target as HTMLInputElement).checked) })}
                            ${__('Terms can be nested, like categories')}
                        </label>
                        ${component(Button, { type: 'submit', disabled: !this.draft.label.trim() }, __('Add taxonomy'))}
                    </form>`))}
            </div>
        </div>`;
    }
}
