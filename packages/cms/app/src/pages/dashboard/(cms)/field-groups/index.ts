import { Cossack, Page, State, type HeadValue } from '@cossackframework/core';
import { Badge, Card, CardBody } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { flattenGroupFields, PERMISSIONS, type FieldGroupTarget } from '@cossackframework/cms';
import { requireAny } from '../../../../cms/guards';
import { linkButton, pageHeader } from '../../../../cms/ui';

interface Row { id: string; title: string; description: string; placement: string; fields: number; targets: string[] }

/** Field groups: meta boxes of typed fields, laid out with blocks and attached to collections, taxonomies, users and menu items. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageCollections)] })
export default class FieldGroupsPage extends Cossack {
    @State() rows: Row[] = [];

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

    render() {
        const th = 'px-3 py-2 font-medium';
        const td = 'px-3 py-2';
        return html`<div class="space-y-6">
            ${pageHeader(__('Field groups'), {
                description: __('Boxes of fields shown in editors: lay typed fields out with columns, tabs and headings, then attach the box to collections, taxonomies, users or menu items.'),
                titleActions: linkButton(__('New field group'), '/dashboard/field-groups/new', 'primary', { size: 'sm' }),
            })}
            ${component(Card, {}, component(CardBody, { class: 'p-0' }, html`
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead><tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th class=${th}>${__('Title')}</th><th class=${th}>${__('Shown on')}</th><th class=${th}>${__('Placement')}</th><th class=${`${th} text-right`}>${__('Fields')}</th>
                        </tr></thead>
                        <tbody>${this.rows.map(row => html`<tr class="group border-b border-border last:border-0 align-top" data-field-group=${row.id}>
                            <td class=${td}>
                                <a href=${`/dashboard/field-groups/${row.id}`} class="font-medium text-foreground hover:text-primary no-underline">${row.title}</a>
                                ${row.description ? html`<p class="text-xs text-muted-foreground">${row.description}</p>` : null}
                                <div class="mt-1 flex flex-wrap items-center gap-2 text-xs opacity-80 group-hover:opacity-100">
                                    <a href=${`/dashboard/field-groups/${row.id}`} class="text-primary hover:underline">${__('Edit')}</a>
                                    <span aria-hidden="true" class="text-muted-foreground">|</span>
                                    <code class="text-muted-foreground">${row.id}</code>
                                </div>
                            </td>
                            <td class=${`${td} text-muted-foreground`}>${row.targets.join(', ') || __('nothing yet')}</td>
                            <td class=${td}>${component(Badge, { variant: 'outline' }, row.placement === 'sidebar' ? __('Sidebar') : __('Main column'))}</td>
                            <td class=${`${td} text-right text-muted-foreground`}>${row.fields}</td>
                        </tr>`)}</tbody>
                    </table>
                    ${this.rows.length ? null : html`<p class="px-3 py-8 text-center text-sm text-muted-foreground">${__('No field groups yet. A field group holds a collection\'s fields as a box in its editor, and can show in several places at once.')}</p>`}
                </div>`))}
        </div>`;
    }
}
