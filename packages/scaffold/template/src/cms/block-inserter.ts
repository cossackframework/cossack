/**
 * The block picker of the entry editor: a button that opens the block types grouped by
 * category, with their icons and a search box, as WordPress's inserter does.
 */
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { BLOCK_CATEGORIES, type BlockCategory } from '@cossackframework/cms';
import { Icon, Popover } from '@cossackframework/ui';
import { AddSquareIcon } from '@cossackframework/solar-icons/add-square/line';
import { blockIcon } from './icons';

const addIcon = { line: AddSquareIcon };

export type BlockInserterProps = {
    /** Page-unique ID of the button; the panel is `<id>-content`. */
    id: string;
    blocks: { name: string; label: string; description?: string; icon: string; category: BlockCategory }[];
    onPick(name: string): void;
    disabled?: boolean;
    /** Smaller button for toolbars. */
    compact?: boolean;
};

@Component()
export class BlockInserter extends Cossack {
    declare props: BlockInserterProps;
    @ClientState() private search = '';

    @Client()
    private pick(name: string) {
        document.getElementById(`${this.props.id}-content`)?.hidePopover();
        this.search = '';
        this.props.onPick(name);
    }

    render() {
        const query = this.search.trim().toLowerCase();
        const matches = this.props.blocks.filter(block => !query || block.label.toLowerCase().includes(query) || block.name.includes(query)
            || (block.description ?? '').toLowerCase().includes(query));
        const groups = BLOCK_CATEGORIES.map(category => ({ ...category, blocks: matches.filter(block => block.category === category.id) })).filter(group => group.blocks.length);
        const size = this.props.compact ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm';
        return component(Popover, {
            id: this.props.id, side: 'bottom', align: 'start', '?disabled': Boolean(this.props.disabled),
            class: `gap-1.5 border border-border bg-background font-medium text-foreground hover:bg-muted ${size}`,
            trigger: html`${component(Icon, { entry: addIcon, size: 16 })}<span>${__('Add block')}</span>`,
            contentProps: { role: 'dialog', 'aria-label': __('Blocks'), class: 'w-80 max-w-[calc(100vw-2rem)] space-y-3' },
        }, html`
            <input type="search" autofocus aria-label=${__('Search blocks')} placeholder=${__('Search')} .value=${this.search}
                class="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                @input=${(event: Event) => { this.search = (event.target as HTMLInputElement).value; }}>
            <div class="max-h-80 space-y-3 overflow-y-auto">
                ${groups.length ? groups.map(group => html`<section aria-label=${__(group.label)}>
                    <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">${__(group.label)}</h3>
                    <ul class="grid grid-cols-3 gap-1">${group.blocks.map(block => html`<li>
                        <button type="button" title=${block.description || block.label} @click=${() => this.pick(block.name)}
                            class="flex w-full flex-col items-center gap-1.5 rounded-md border-none bg-transparent px-1 py-2 text-xs text-foreground cursor-pointer hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <span class="inline-flex text-muted-foreground [&_svg]:size-5">${component(Icon, { entry: blockIcon(block.icon), size: 20 })}</span>
                            <span class="text-center leading-tight">${block.label}</span>
                        </button>
                    </li>`)}</ul>
                </section>`) : html`<p class="py-4 text-center text-sm text-muted-foreground">${__('No blocks match.')}</p>`}
            </div>
        `);
    }
}
