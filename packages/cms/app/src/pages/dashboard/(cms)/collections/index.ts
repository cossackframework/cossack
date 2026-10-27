import { Cossack, Page, State, type HeadValue } from '@cossackframework/core';
import { Badge, Card, CardBody, Icon } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { PERMISSIONS } from '@cossackframework/cms';
import { requireAny } from '../../../../cms/guards';
import { icon } from '../../../../cms/icons';
import { linkButton, pageHeader } from '../../../../cms/ui';

interface Row { name: string; label: string; singular: string; icon: string; builtin: boolean; entries: number; fields: number; taxonomies: string[]; path: string | null }

/** Collections: content types such as posts, pages and products, as a list table. Each has its own document table and fields. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageCollections)] })
export default class CollectionsPage extends Cossack {
    @State() rows: Row[] = [];

    head(): HeadValue {
        return { title: 'Collections' };
    }

    async init() {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const labels = new Map(cms.taxonomies.declarations.map(taxonomy => [taxonomy.name, taxonomy.label]));
        // A managed collection (forms) has screens of its own and is not listed.
        this.rows = await Promise.all(cms.collections().filter(collection => !collection.managed).map(async collection => ({
            name: collection.name, label: collection.label, singular: collection.singular, icon: collection.icon ?? 'document-text', builtin: collection.builtin === true,
            entries: await cms.resource(`cms/${collection.name}`).count({}, { principal }).catch(() => 0),
            fields: Object.keys(collection.fields).length, taxonomies: (collection.taxonomies ?? []).map(name => labels.get(name) ?? name), path: collection.path ?? null,
        })));
    }

    render() {
        const th = 'px-3 py-2 font-medium';
        const td = 'px-3 py-2';
        return html`<div class="space-y-6">
            ${pageHeader(__('Collections'), {
                description: __('Content types and their fields. Each collection has its own list, editor and site URLs.'),
                titleActions: linkButton(__('Add new collection'), '/dashboard/collections/new', 'primary', { size: 'sm' }),
            })}
            ${component(Card, {}, component(CardBody, { class: 'p-0' }, html`
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead><tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th class=${th}>${__('Collection')}</th><th class=${th}>${__('Name')}</th><th class=${`${th} text-right`}>${__('Entries')}</th>
                            <th class=${`${th} text-right`}>${__('Added fields')}</th><th class=${th}>${__('Taxonomies')}</th><th class=${th}>${__('URL')}</th>
                        </tr></thead>
                        <tbody>${this.rows.map(row => html`<tr class="group border-b border-border last:border-0 align-top" data-collection=${row.name}>
                            <td class=${td}>
                                <div class="flex items-start gap-3">
                                    <span class="mt-0.5 inline-flex shrink-0 text-muted-foreground [&_svg]:size-5">${component(Icon, { entry: icon(row.icon), size: 20 })}</span>
                                    <div class="min-w-0">
                                        <a href=${`/dashboard/collections/${row.name}`} class="font-medium text-foreground hover:text-primary no-underline">${row.label}</a>
                                        ${row.builtin ? html` ${component(Badge, { variant: 'secondary' }, __('Built in'))}` : null}
                                        <div class="mt-1 flex flex-wrap items-center gap-2 text-xs opacity-80 group-hover:opacity-100">
                                            <a href=${`/dashboard/collections/${row.name}`} class="text-primary hover:underline">${__('Edit')}</a>
                                            <span aria-hidden="true" class="text-muted-foreground">|</span>
                                            <a href=${`/dashboard/content/${row.name}`} class="text-primary hover:underline">${__('Entries')}</a>
                                        </div>
                                    </div>
                                </div>
                            </td>
                            <td class=${td}><code class="text-xs text-muted-foreground">${row.name}</code><span class="block text-xs text-muted-foreground">${row.singular}</span></td>
                            <td class=${`${td} text-right text-muted-foreground`}>${row.entries}</td>
                            <td class=${`${td} text-right text-muted-foreground`}>${row.fields}</td>
                            <td class=${`${td} text-muted-foreground`}>${row.taxonomies.join(', ') || '—'}</td>
                            <td class=${`${td} text-muted-foreground`}>${row.path === null ? __('not on the site') : html`<code class="text-xs">/${row.path}</code>`}</td>
                        </tr>`)}</tbody>
                    </table>
                </div>`))}
        </div>`;
    }
}
