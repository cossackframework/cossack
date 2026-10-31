/**
 * The block picker of the entry editor: a button that opens the block types grouped by
 * category, with their icons and a search box, as WordPress's inserter does. The types the
 * user inserted last come first, under Recent; they are kept in the user's meta.
 */
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { BLOCK_CATEGORIES, type BlockCategory } from '@cossackframework/cms';
import { Icon, Popover } from '@cossackframework/ui';
import { AddSquareIcon } from '@cossackframework/solar-icons/add-square/line';
import { blockIcon, blockIconColor } from './icons';

const addIcon = { line: AddSquareIcon };

/** The user's recent block types, newest first, shared by the page's inserters; loaded once. */
let recentTypes: Promise<string[]> | null = null;

function loadRecent(): Promise<string[]> {
    recentTypes ??= fetch('/api/cms/me/recent-blocks').then(response => response.ok ? response.json() as Promise<{ types: string[] }> : { types: [] }).then(result => result.types).catch(() => []);
    return recentTypes;
}

/** Put a type first among the recent ones, here and in the user's meta. */
function rememberType(type: string): Promise<string[]> {
    recentTypes = loadRecent().then(types => [type, ...types.filter(entry => entry !== type)].slice(0, 6));
    void fetch('/api/cms/me/recent-blocks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type }) }).catch(() => undefined);
    return recentTypes;
}

export type BlockInserterProps = {
    /** Page-unique ID of the button; the panel is `<id>-content`. */
    id: string;
    blocks: { name: string; label: string; description?: string; icon: string; category: BlockCategory; keywords?: readonly string[] }[];
    onPick(name: string): void;
    disabled?: boolean;
    /** Smaller button for toolbars. */
    compact?: boolean;
};

@Component()
export class BlockInserter extends Cossack {
    declare props: BlockInserterProps;
    @ClientState() private search = '';
    @ClientState() private recent: string[] = [];

    onMount() {
        void loadRecent().then(types => { this.recent = types; });
    }

    @Client()
    private pick(name: string) {
        document.getElementById(`${this.props.id}-content`)?.hidePopover();
        this.search = '';
        this.props.onPick(name);
        void rememberType(name).then(types => { this.recent = types; });
    }

    private button(block: BlockInserterProps['blocks'][number]) {
        return html`<li>
            <button type="button" title=${block.description || block.label} @click=${() => this.pick(block.name)}
                class="flex w-full flex-col items-center gap-1.5 rounded-md border-none bg-transparent px-1 py-2 text-xs text-foreground cursor-pointer hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span class=${`inline-flex [&_svg]:size-5 ${blockIconColor(block.category)}`}>${component(Icon, { entry: blockIcon(block.icon), size: 20 })}</span>
                <span class="text-center leading-tight">${block.label}</span>
            </button>
        </li>`;
    }

    render() {
        const query = this.search.trim().toLowerCase();
        const matches = this.props.blocks.filter(block => !query || block.label.toLowerCase().includes(query) || block.name.includes(query)
            || (block.description ?? '').toLowerCase().includes(query) || (block.keywords ?? []).some(word => word.toLowerCase().includes(query)));
        const groups = BLOCK_CATEGORIES.map(category => ({ ...category, blocks: matches.filter(block => block.category === category.id) })).filter(group => group.blocks.length);
        // Recent types this inserter offers, before the categories while nothing is searched.
        const recent = query ? [] : this.recent.map(type => this.props.blocks.find(block => block.name === type)).filter((block): block is BlockInserterProps['blocks'][number] => !!block);
        const size = this.props.compact ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm';
        return component(Popover, {
            id: this.props.id, side: 'bottom', align: 'start', '?disabled': Boolean(this.props.disabled),
            class: `cms-add-block gap-1.5 font-medium text-foreground ${size}`,
            trigger: html`${component(Icon, { entry: addIcon, size: 16 })}<span>${__('Add block')}</span>`,
            contentProps: { role: 'dialog', 'aria-label': __('Blocks'), class: 'w-80 max-w-[calc(100vw-2rem)] space-y-3' },
        }, html`
            <input type="search" autofocus aria-label=${__('Search blocks')} placeholder=${__('Search')} .value=${this.search}
                class="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                @input=${(event: Event) => { this.search = (event.target as HTMLInputElement).value; }}>
            <div class="max-h-80 space-y-3 overflow-y-auto">
                ${recent.length ? html`<section aria-label=${__('Recent')} data-recent-blocks>
                    <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">${__('Recent')}</h3>
                    <ul class="grid grid-cols-3 gap-1">${recent.map(block => this.button(block))}</ul>
                </section>` : null}
                ${groups.length ? groups.map(group => html`<section aria-label=${__(group.label)}>
                    <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">${__(group.label)}</h3>
                    <ul class="grid grid-cols-3 gap-1">${group.blocks.map(block => this.button(block))}</ul>
                </section>`) : html`<p class="py-4 text-center text-sm text-muted-foreground">${__('No blocks match.')}</p>`}
            </div>
        `);
    }
}
