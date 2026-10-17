import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Badge, Button, Card, CardBody, Field, Input, NativeSelect, Icon } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, PERMISSIONS } from '@cossackframework/cms';
import { collectionName } from '../../../../cms/builder';
import { requireAny } from '../../../../cms/guards';
import { COLLECTION_ICONS, icon } from '../../../../cms/icons';
import { notice, pageHeader } from '../../../../cms/ui';

interface Row { name: string; label: string; icon: string; builtin: boolean; entries: number; fields: number; taxonomies: string[]; path: string | null }

/** Collections: content types such as posts, pages and products. Each has its own document table and fields. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageCollections)] })
export default class CollectionsPage extends Cossack {
    @State() rows: Row[] = [];
    @State() draft = { label: '', singular: '', icon: 'box' };
    @State() error = '';

    head(): HeadValue {
        return { title: 'Collections' };
    }

    async init() {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const labels = new Map(cms.taxonomies.declarations.map(taxonomy => [taxonomy.name, taxonomy.label]));
        this.rows = await Promise.all(cms.collections().map(async collection => ({
            name: collection.name, label: collection.label, icon: collection.icon ?? 'document-text', builtin: collection.builtin === true,
            entries: await cms.resource(`cms/${collection.name}`).count({}, { principal }).catch(() => 0),
            fields: Object.keys(collection.fields).length, taxonomies: (collection.taxonomies ?? []).map(name => labels.get(name) ?? name), path: collection.path ?? null,
        })));
    }

    @Client()
    setDraft(name: 'label' | 'singular' | 'icon', value: string) {
        this.draft = { ...this.draft, [name]: value };
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.create(this.draft.label, this.draft.singular, this.draft.icon);
    }

    @Server()
    async create(label: string, singular: string, iconName: string) {
        this.error = '';
        const name = collectionName(label);
        try {
            await this.c.get('cms').saveCollection({
                name, label, singular: singular.trim() || label.trim().replace(/s$/i, ''), icon: iconName,
                path: name.replaceAll('_', '-'), slug: true, publishable: true, fields: {},
            }, this.c.get('principal'));
            return this.redirect(`/dashboard/collections/${name}?created=1`);
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The collection could not be created.');
        }
    }

    render() {
        return html`<div class="space-y-6">
            ${pageHeader(__('Collections'), { description: __('Content types and their fields. Each collection has its own list, editor and site URLs.') })}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <ul class="grid gap-4 sm:grid-cols-2">${this.rows.map(row => html`<li>
                    <a href=${`/dashboard/collections/${row.name}`} class="block h-full rounded-lg border border-border bg-card p-4 no-underline hover:ring-2 hover:ring-ring">
                        <div class="flex items-start justify-between gap-2">
                            <span class="flex items-center gap-2 text-base font-semibold text-foreground">
                                <span class="inline-flex [&_svg]:size-5 text-muted-foreground">${component(Icon, { entry: icon(row.icon), size: 20 })}</span>${row.label}
                            </span>
                            ${row.builtin ? component(Badge, { variant: 'secondary' }, __('Built in')) : null}
                        </div>
                        <dl class="mt-3 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                            <dt>${__('Entries')}</dt><dd class="text-foreground">${row.entries}</dd>
                            <dt>${__('Added fields')}</dt><dd class="text-foreground">${row.fields}</dd>
                            <dt>${__('Taxonomies')}</dt><dd class="text-foreground">${row.taxonomies.join(', ') || '—'}</dd>
                            <dt>${__('URL')}</dt><dd class="font-mono text-foreground">${row.path === null ? __('not on the site') : `/${row.path}`}</dd>
                        </dl>
                    </a>
                </li>`)}</ul>
                ${component(Card, {}, component(CardBody, {}, html`
                    <h2 class="mb-4 text-base font-semibold text-foreground">${__('Add collection')}</h2>
                    <form class="space-y-4" @submit=${(event: Event) => this.submit(event)}>
                        ${component(Field, { label: __('Plural name'), for: 'collection-label', hint: this.draft.label ? `${__('Stored as')} ${collectionName(this.draft.label) || '…'}` : __('Such as Products or Events.'),
                            control: attributes => component(Input, { ...attributes, '.value': this.draft.label, '@input': (event: Event) => this.setDraft('label', (event.target as HTMLInputElement).value) }) })}
                        ${component(Field, { label: __('Singular name'), for: 'collection-singular', hint: __('Such as Product.'),
                            control: attributes => component(Input, { ...attributes, '.value': this.draft.singular, '@input': (event: Event) => this.setDraft('singular', (event.target as HTMLInputElement).value) }) })}
                        ${component(Field, { label: __('Icon'), for: 'collection-icon',
                            control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => this.setDraft('icon', (event.target as HTMLSelectElement).value) }, html`
                                ${COLLECTION_ICONS.map(name => html`<option value=${name} ?selected=${name === this.draft.icon}>${name}</option>`)}`) })}
                        ${component(Button, { type: 'submit', disabled: !collectionName(this.draft.label) }, __('Create collection'))}
                    </form>`))}
            </div>
        </div>`;
    }
}
