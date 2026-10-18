/**
 * The rich text field of the entry editor: a WordPress-style toolbar over a TipTap surface.
 * The editor loads in the browser only; the field stores the document as JSON.
 */
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import type { EmbeddedBlock, RichTextDoc } from '@cossackframework/cms';
import type { RichTextCommand, RichTextHandle } from './rich-text.client';
import { BlockInserter, type BlockInserterProps } from './block-inserter';
import { PROSE } from './site-view';

export type RichTextFieldProps = {
    /** The field's element ID; the page reaches the editor by it in `richTextEditors`. */
    id: string;
    label: string;
    value: RichTextDoc | null;
    placeholder?: string;
    /** Block types that can be embedded. */
    blocks: BlockInserterProps['blocks'];
    onChange(doc: RichTextDoc): void;
    /** Open the media library to insert an image or file. */
    onMedia(): void;
    /** Insert a new block of this type, then edit it. */
    onInsertBlock(type: string): void;
    onEditBlock(block: EmbeddedBlock): void;
    /** Open the patterns, to insert one. */
    onPatterns?(): void;
    /** Titles of synced patterns by ID, shown on their blocks. */
    patternTitles?: Record<string, string>;
};

/** Mounted editors by field ID, for the page's media picker and block forms. */
export const richTextEditors = new Map<string, RichTextHandle>();

const SURFACE = `${PROSE} min-h-[22rem] px-4 py-3 focus:outline-none [&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)] [&_img.ProseMirror-selectednode]:ring-2 [&_img.ProseMirror-selectednode]:ring-ring`;

@Component()
export class RichTextField extends Cossack {
    declare props: RichTextFieldProps;
    @ClientState() private ready = false;
    @ClientState() private failed = '';
    @ClientState() private active: string[] = [];
    @ClientState() private linkOpen = false;
    @ClientState() private linkUrl = '';
    @ClientState() private linkNewTab = false;
    private handle?: RichTextHandle;
    private surface?: HTMLElement;

    @Client()
    private async connect(element: Element | undefined) {
        if (!element || this.surface === element) return;
        this.surface = element as HTMLElement;
        try {
            const { mountRichText } = await import('./rich-text.client');
            this.handle?.destroy();
            const labels = new Map(this.props.blocks.map(block => [block.name, block.label]));
            this.handle = mountRichText(this.surface, {
                content: this.props.value, label: this.props.label, placeholder: this.props.placeholder ?? __('Start writing…'), className: SURFACE,
                blockLabel: type => type === 'core/pattern' ? __('Synced pattern') : labels.get(type) ?? type,
                blockSummary: block => block.type === 'core/pattern' ? this.props.patternTitles?.[String(block.data.pattern)] ?? __('Pattern')
                    : Object.values(block.data).find((value): value is string => typeof value === 'string' && value.trim() !== '') ?? '',
                onChange: doc => this.props.onChange(doc),
                onSelection: active => { if (active.join() !== this.active.join()) this.active = active; },
                onEditBlock: block => this.props.onEditBlock(block),
            });
            richTextEditors.set(this.props.id, this.handle);
            this.ready = true;
        } catch (error) {
            console.error('[cms] the rich text editor could not load', error);
            this.failed = __('The editor could not load. Reload the page to try again.');
        }
    }

    onCleanup() {
        this.handle?.destroy();
        if (richTextEditors.get(this.props.id) === this.handle) richTextEditors.delete(this.props.id);
    }

    @Client()
    private run(command: RichTextCommand) {
        this.handle?.run(command);
    }

    @Client()
    private openLink() {
        const current = this.handle?.linkAt();
        this.linkUrl = current?.href ?? '';
        this.linkNewTab = current?.newTab ?? false;
        this.linkOpen = true;
    }

    @Client()
    private applyLink(event: Event) {
        event.preventDefault();
        const url = this.linkUrl.trim();
        if (url) this.handle?.link(/^[a-z][a-z0-9+.-]*:|^[/#]/i.test(url) ? url : `https://${url}`, this.linkNewTab);
        else this.handle?.run('unlink');
        this.linkOpen = false;
    }

    private tool(label: string, title: string, command: RichTextCommand | (() => void), name = typeof command === 'string' ? command : ''): TemplateResult {
        const on = name !== '' && this.active.includes(name);
        return html`<button type="button" title=${title} aria-label=${title} aria-pressed=${name ? (on ? 'true' : 'false') : ''} ?disabled=${!this.ready}
            class=${`min-w-8 rounded px-2 py-1 text-xs font-medium border-none cursor-pointer disabled:cursor-default disabled:opacity-40 ${on ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            @click=${() => typeof command === 'string' ? this.run(command) : command()}>${label}</button>`;
    }

    render() {
        const format = (['heading2', 'heading3', 'heading4'] as const).find(name => this.active.includes(name)) ?? 'paragraph';
        const separator = html`<span aria-hidden="true" class="mx-1 h-5 w-px bg-border"></span>`;
        return html`<div class="rounded-lg border border-border bg-card">
            <div role="toolbar" aria-label=${`${this.props.label} ${__('formatting')}`} class="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 rounded-t-lg border-b border-border bg-card px-2 py-1.5">
                <select aria-label=${__('Text style')} ?disabled=${!this.ready} class="h-7 rounded border border-input bg-background px-1.5 text-xs text-foreground"
                    @change=${(event: Event) => this.run((event.target as HTMLSelectElement).value as RichTextCommand)}>
                    ${([['paragraph', __('Paragraph')], ['heading2', __('Heading 2')], ['heading3', __('Heading 3')], ['heading4', __('Heading 4')]] as const)
                        .map(([value, label]) => html`<option value=${value} ?selected=${format === value}>${label}</option>`)}
                </select>
                ${separator}
                ${this.tool('B', __('Bold'), 'bold')}${this.tool('I', __('Italic'), 'italic')}${this.tool('U', __('Underline'), 'underline')}${this.tool('S', __('Strikethrough'), 'strike')}${this.tool('</>', __('Code'), 'code')}
                ${separator}
                ${this.tool('•', __('Bulleted list'), 'bulletList')}${this.tool('1.', __('Numbered list'), 'orderedList')}${this.tool('“', __('Quote'), 'blockquote')}${this.tool('{ }', __('Code block'), 'codeBlock')}
                ${separator}
                ${this.tool('⇤', __('Align left'), 'alignLeft', '')}${this.tool('↔', __('Align center'), 'alignCenter')}${this.tool('⇥', __('Align right'), 'alignRight')}
                ${separator}
                ${this.tool(__('Link'), __('Insert or edit link'), () => this.openLink(), 'link')}${this.tool('—', __('Horizontal line'), 'horizontalRule', '')}
                ${this.tool('↶', __('Undo'), 'undo', '')}${this.tool('↷', __('Redo'), 'redo', '')}
                ${separator}
                ${this.tool(__('Add media'), __('Add media'), () => this.props.onMedia())}
                ${this.props.onPatterns ? this.tool(__('Patterns'), __('Insert a pattern'), () => this.props.onPatterns?.()) : null}
                ${this.props.blocks.length ? component(BlockInserter, { id: `${this.props.id}-blocks`, blocks: this.props.blocks, disabled: !this.ready, compact: true,
                    onPick: (name: string) => this.props.onInsertBlock(name) }) : null}
            </div>
            ${this.linkOpen ? html`<form class="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2" @submit=${(event: Event) => this.applyLink(event)}>
                <input type="text" inputmode="url" aria-label=${__('Link URL')} placeholder="https://" .value=${this.linkUrl} autofocus
                    class="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    @input=${(event: Event) => { this.linkUrl = (event.target as HTMLInputElement).value; }}>
                <label class="flex items-center gap-1.5 text-xs text-foreground"><input type="checkbox" .checked=${this.linkNewTab}
                    @change=${(event: Event) => { this.linkNewTab = (event.target as HTMLInputElement).checked; }}> ${__('Open in a new tab')}</label>
                <button type="submit" class="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground border-none cursor-pointer">${this.linkUrl.trim() ? __('Apply') : __('Remove link')}</button>
                <button type="button" class="rounded-md border border-border bg-background px-3 py-1 text-xs text-foreground cursor-pointer" @click=${() => { this.linkOpen = false; }}>${__('Cancel')}</button>
            </form>` : null}
            ${this.failed ? html`<p role="alert" class="px-4 py-3 text-sm text-destructive">${this.failed}</p>`
                : this.ready ? null : html`<p class="px-4 py-3 text-sm text-muted-foreground">${__('Loading the editor…')}</p>`}
            <div id=${this.props.id} class="rich-text-surface" ref=${(element: Element) => this.connect(element)}></div>
        </div>`;
    }
}
