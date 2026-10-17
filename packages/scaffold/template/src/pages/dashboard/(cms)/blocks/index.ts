import { Cossack, Page, State, type HeadValue } from '@cossackframework/core';
import { Badge, Card, CardBody } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { PERMISSIONS } from '@cossackframework/cms';
import { FIELD_TYPES, typeOf } from '../../../../cms/builder';
import { requireAny } from '../../../../cms/guards';
import { pageHeader } from '../../../../cms/ui';

interface BlockRow { name: string; label: string; description: string; plugin: string; fields: { name: string; label: string; type: string; required: boolean }[] }

/** The block types available to blocks fields: built-in ones and those of active plugins. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageCollections)] })
export default class BlocksPage extends Cossack {
    @State() blocks: BlockRow[] = [];

    head(): HeadValue {
        return { title: 'Blocks' };
    }

    async init() {
        this.blocks = (await this.c.get('cms').blocks()).map(block => ({
            name: block.name, label: block.label, description: block.description ?? '', plugin: block.plugin ?? '',
            fields: Object.entries(block.fields).map(([name, declaration]) => ({ name, label: declaration.label ?? name, required: declaration.required === true,
                type: FIELD_TYPES.find(option => option.type === typeOf(declaration))?.label ?? declaration.kind })),
        }));
    }

    render() {
        return html`<div class="space-y-6">
            ${pageHeader(__('Blocks'), { description: __('Add a Blocks field to a collection to build entries from these. Plugins can add block types.') })}
            <ul class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">${this.blocks.map(block => html`<li>
                ${component(Card, { class: 'h-full' }, component(CardBody, { class: 'space-y-2' }, html`
                    <div class="flex items-center justify-between gap-2">
                        <h2 class="text-base font-semibold text-foreground">${block.label}</h2>
                        ${component(Badge, { variant: block.plugin ? 'outline' : 'secondary' }, block.plugin || __('Core'))}
                    </div>
                    <code class="text-xs text-muted-foreground">${block.name}</code>
                    ${block.description ? html`<p class="text-sm text-muted-foreground">${block.description}</p>` : null}
                    <ul class="space-y-0.5 text-xs text-muted-foreground">${block.fields.length
                        ? block.fields.map(entry => html`<li><span class="text-foreground">${entry.label}</span> · ${entry.type}${entry.required ? ` · ${__('required')}` : ''}</li>`)
                        : html`<li>${__('No fields.')}</li>`}</ul>`))}
            </li>`)}</ul>
        </div>`;
    }
}
