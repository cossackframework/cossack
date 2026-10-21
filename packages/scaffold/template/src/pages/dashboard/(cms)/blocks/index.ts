import { Cossack, Page, State, type HeadValue } from '@cossackframework/core';
import { Badge, Card, CardBody, Icon } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { BLOCK_CATEGORIES, blockCategory, blockSupports, PERMISSIONS, type BlockCategory } from '@cossackframework/cms';
import { FIELD_TYPES, typeOf } from '../../../../cms/builder';
import { requireAny } from '../../../../cms/guards';
import { blockIcon } from '../../../../cms/icons';
import { pageHeader } from '../../../../cms/ui';

const STYLE_LABELS = { background: 'background', text: 'text colour', padding: 'padding', margin: 'margin', fontSize: 'font size', align: 'alignment' } as const;

interface BlockRow { name: string; label: string; description: string; icon: string; category: BlockCategory; plugin: string; fields: { name: string; label: string; type: string; required: boolean }[]; holds: string; parent: string; style: string }

/** The block types available to blocks fields, by category: built-in ones and those of active plugins. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageCollections)] })
export default class BlocksPage extends Cossack {
    @State() blocks: BlockRow[] = [];

    head(): HeadValue {
        return { title: 'Blocks' };
    }

    async init() {
        this.blocks = (await this.c.get('cms').blocks()).map(block => ({
            name: block.name, label: block.label, description: block.description ?? '', icon: block.icon ?? '', category: blockCategory(block), plugin: block.plugin ?? '',
            fields: Object.entries(block.fields).map(([name, declaration]) => ({ name, label: declaration.label ?? name, required: declaration.required === true,
                type: FIELD_TYPES.find(option => option.type === typeOf(declaration))?.label ?? declaration.kind })),
            holds: block.children ? (block.children.allowed?.length ? block.children.allowed.join(', ') : __('any block')) + (block.children.max ? ` (${__('at most')} ${block.children.max})` : '') : '',
            parent: block.parent?.join(', ') ?? '',
            style: blockSupports(block).map(property => STYLE_LABELS[property]).join(', '),
        }));
    }

    render() {
        const groups = BLOCK_CATEGORIES.map(category => ({ ...category, blocks: this.blocks.filter(block => block.category === category.id) })).filter(group => group.blocks.length);
        return html`<div class="space-y-8">
            ${pageHeader(__('Blocks'), { description: __('Add a Blocks field to a collection to build entries from these. Plugins can add block types.') })}
            ${groups.map(group => html`<section class="space-y-3" aria-labelledby=${`blocks-${group.id}`}>
                <h2 id=${`blocks-${group.id}`} class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">${__(group.label)}</h2>
                <ul class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">${group.blocks.map(block => html`<li>
                    ${component(Card, { class: 'h-full' }, component(CardBody, { class: 'space-y-2' }, html`
                        <div class="flex items-center justify-between gap-2">
                            <h3 class="flex items-center gap-2 text-base font-semibold text-foreground">
                                <span class="inline-flex text-muted-foreground [&_svg]:size-5">${component(Icon, { entry: blockIcon(block.icon), size: 20 })}</span>${block.label}
                            </h3>
                            ${component(Badge, { variant: block.plugin ? 'outline' : 'secondary' }, block.plugin || __('Core'))}
                        </div>
                        <code class="text-xs text-muted-foreground">${block.name}</code>
                        ${block.description ? html`<p class="text-sm text-muted-foreground">${block.description}</p>` : null}
                        <ul class="space-y-0.5 text-xs text-muted-foreground">${block.fields.length
                            ? block.fields.map(entry => html`<li><span class="text-foreground">${entry.label}</span> · ${entry.type}${entry.required ? ` · ${__('required')}` : ''}</li>`)
                            : html`<li>${__('No fields.')}</li>`}
                            ${block.holds ? html`<li>${__('Holds')}: ${block.holds}</li>` : null}
                            ${block.parent ? html`<li>${__('Goes inside')}: ${block.parent}</li>` : null}
                            <li>${__('Style')}: ${block.style || __('none')}</li></ul>`))}
                </li>`)}</ul>
            </section>`)}
        </div>`;
    }
}
