import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Badge, Button, Card, CardBody, Field, Input } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { flattenGroupFields, isCmsError, PERMISSIONS, type FieldGroupTarget } from '@cossackframework/cms';
import { collectionName } from '../../../../cms/builder';
import { requireAny } from '../../../../cms/guards';
import { notice, pageHeader } from '../../../../cms/ui';

interface Row { id: string; title: string; description: string; placement: string; fields: number; targets: string[] }

/** Field groups: meta boxes of typed fields, laid out with blocks and attached to collections, taxonomies, users and menu items. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageCollections)] })
export default class FieldGroupsPage extends Cossack {
    @State() rows: Row[] = [];
    @State() title = '';
    @State() error = '';

    head(): HeadValue {
        return { title: __('Field groups') };
    }

    async init() {
        const cms = this.c.get('cms');
        const labels = new Map<string, string>([
            ...cms.collections().map(collection => [`collection:${collection.name}`, collection.label] as const),
            ...cms.taxonomies.declarations.map(taxonomy => [`taxonomy:${taxonomy.name}`, taxonomy.label] as const),
        ]);
        const label = (target: FieldGroupTarget) => target.kind === 'users' ? __('Users') : target.kind === 'menus' ? __('Menu items') : 'name' in target ? labels.get(`${target.kind}:${target.name}`) ?? target.name : target.kind;
        this.rows = (await cms.fieldGroups.all()).map(group => ({
            id: group.id, title: group.title, description: group.description ?? '', placement: group.placement ?? 'main',
            fields: flattenGroupFields(group.blocks).length, targets: group.targets.map(label),
        }));
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.create(this.title);
    }

    @Server()
    async create(title: string) {
        this.error = '';
        const id = collectionName(title).replaceAll('_', '-');
        try {
            await this.c.get('cms').saveFieldGroup({ id, title: title.trim(), targets: [], blocks: [] }, this.c.get('principal'));
            return this.redirect(`/dashboard/field-groups/${id}?created=1`);
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The field group could not be created.');
        }
    }

    render() {
        return html`<div class="space-y-6">
            ${pageHeader(__('Field groups'), { description: __('Boxes of fields shown in editors: lay typed fields out with columns, tabs and headings, then attach the box to collections, taxonomies, users or menu items.') })}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
                ${this.rows.length ? html`<ul class="grid gap-4 sm:grid-cols-2">${this.rows.map(row => html`<li>
                    <a href=${`/dashboard/field-groups/${row.id}`} class="block h-full rounded-lg border border-border bg-card p-4 no-underline hover:ring-2 hover:ring-ring">
                        <div class="flex items-start justify-between gap-2">
                            <span class="text-base font-semibold text-foreground">${row.title}</span>
                            ${component(Badge, { variant: 'outline' }, row.placement === 'sidebar' ? __('Sidebar') : __('Main column'))}
                        </div>
                        ${row.description ? html`<p class="mt-1 text-sm text-muted-foreground">${row.description}</p>` : null}
                        <dl class="mt-3 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                            <dt>${__('Fields')}</dt><dd class="text-foreground">${row.fields}</dd>
                            <dt>${__('Shown on')}</dt><dd class="text-foreground">${row.targets.join(', ') || __('nothing yet')}</dd>
                        </dl>
                    </a>
                </li>`)}</ul>` : html`<p class="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">${__('No field groups yet. A collection\'s own fields are laid out in its builder; a field group adds a box of fields to several places at once.')}</p>`}
                ${component(Card, {}, component(CardBody, {}, html`
                    <h2 class="mb-4 text-base font-semibold text-foreground">${__('Add field group')}</h2>
                    <form class="space-y-4" @submit=${(event: Event) => this.submit(event)}>
                        ${component(Field, { label: __('Title'), for: 'group-title', hint: this.title ? `${__('Stored as')} ${collectionName(this.title).replaceAll('_', '-') || '…'}` : __('Such as Product details.'),
                            control: attributes => component(Input, { ...attributes, '.value': this.title, '@input': (event: Event) => { this.title = (event.target as HTMLInputElement).value; } }) })}
                        ${component(Button, { type: 'submit', disabled: !collectionName(this.title) }, __('Create field group'))}
                    </form>`))}
            </div>
        </div>`;
    }
}
