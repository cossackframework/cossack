/**
 * The rich text field of the entry editor: a WordPress-style toolbar over a TipTap surface.
 * The editor loads in the browser only; the field stores the document as JSON.
 */
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { DropdownMenu, Icon } from '@cossackframework/ui';
import type { EmbeddedBlock, RichTextDoc } from '@cossackframework/cms';
import type { CollabTransport, RichTextCommand, RichTextHandle } from './rich-text.client';
import { BlockInserter, type BlockInserterProps } from './block-inserter';
import type { BindingChoice } from './field-controls';
import { icon } from './icons';
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
    /** Entry fields the text may show (`{{ $.price }}`); a toolbar menu inserts one at the cursor. */
    bindings?: readonly BindingChoice[];
    /** Edit the document together in the entry's room: it comes from there, and every change goes through it. */
    collab?: RichTextCollabProps;
};

export interface RichTextCollabProps {
    /** The document's path in the room (`richTextPath`). */
    path: string;
    /** This browser tab's ID in the room. */
    clientID: string;
    transport: CollabTransport;
    /** The selection moved, for other editors' carets. */
    onSelection(anchor: number, head: number): void;
}

/** Mounted editors by field ID, for the page's media picker and block forms. */
export const richTextEditors = new Map<string, RichTextHandle>();
/** Mounted editors by their document's path in the room, for the room's steps and carets. */
export const collabEditors = new Map<string, RichTextHandle>();

const SURFACE = `${PROSE} min-h-[22rem] px-4 py-3 focus:outline-none [&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)] [&_img.ProseMirror-selectednode]:ring-2 [&_img.ProseMirror-selectednode]:ring-ring`;

/** A document as JSON, for telling the editor's own value from one set from outside. */
function docKey(value: RichTextDoc | null | undefined): string {
    try { return JSON.stringify(value ?? null); } catch { return ''; }
}

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
    /** The document the editor holds, as JSON: what it last emitted or was given. */
    private held = '';
    /** The value last compared with `held`: the page renders the same object again on every unrelated keystroke. */
    private heldValue: RichTextDoc | null | undefined;
    /** When the room's document could not be fetched: the editor runs alone until this time, then tries again. */
    private collabRetryAt = 0;
    /** A mount is under way (the editor loads, the room answers): no second one starts meanwhile. */
    private busy = false;

    /**
     * A value that changed outside the editor (a restored autosave, the entry as saved, a pattern
     * put in by the page) replaces the document; the editor's own edits come back as the same
     * value and leave it alone.
     */
    @Client()
    updated(changed: Map<string | number | symbol, unknown>) {
        super.updated(changed);
        // The room came up after the editor mounted: mount again, on the room's document.
        if (this.props.collab && this.handle && !this.handle.collab && this.surface && this.ready && !this.busy && Date.now() >= this.collabRetryAt) {
            const element = this.surface;
            this.surface = undefined;
            void this.connect(element);
            return;
        }
        // In a room the document is the room's: it changes through steps alone.
        if (this.props.collab || !this.handle || !this.ready || this.props.value === this.heldValue) return;
        this.heldValue = this.props.value;
        const next = docKey(this.props.value);
        if (next === this.held) return;
        this.held = next;
        this.handle.setContent(this.props.value);
    }

    @Client()
    private async connect(element: Element | undefined) {
        if (!element || this.surface === element || this.busy) return;
        this.surface = element as HTMLElement;
        this.busy = true;
        try {
            const { mountRichText } = await import('./rich-text.client');
            this.handle?.destroy();
            const labels = new Map(this.props.blocks.map(block => [block.name, block.label]));
            // In a room the document starts as the room holds it, at the room's version; when the room cannot be
            // reached, the editor runs alone for a while and joins when it comes up.
            const shared = this.props.collab ? await this.sharedDocument(this.props.collab) : null;
            const collab = shared ? this.props.collab : undefined;
            if (this.surface !== element) return;
            this.handle = mountRichText(this.surface, {
                content: shared ? shared.doc : this.props.value, label: this.props.label, placeholder: this.props.placeholder ?? __('Start writing…'), className: SURFACE,
                ...(collab && shared ? { collab: { transport: collab.transport, clientID: collab.clientID, version: shared.version }, onCaret: (anchor: number, head: number) => collab.onSelection(anchor, head) } : {}),
                blockLabel: type => type === 'core/pattern' ? __('Synced pattern') : labels.get(type) ?? type,
                blockSummary: block => block.type === 'core/pattern' ? this.props.patternTitles?.[String(block.data.pattern)] ?? __('Pattern')
                    : Object.values(block.data).find((value): value is string => typeof value === 'string' && value.trim() !== '') ?? '',
                onChange: doc => { this.held = docKey(doc); this.heldValue = doc; this.props.onChange(doc); },
                onSelection: active => { if (active.join() !== this.active.join()) this.active = active; },
                onEditBlock: block => this.props.onEditBlock(block),
            });
            richTextEditors.set(this.props.id, this.handle);
            if (collab) collabEditors.set(collab.path, this.handle);
            this.held = docKey(shared ? shared.doc : this.props.value);
            this.heldValue = shared ? shared.doc : this.props.value;
            this.ready = true;
            // The page's values follow the room's document.
            if (shared && docKey(shared.doc) !== docKey(this.props.value)) this.props.onChange(shared.doc ?? { type: 'doc', content: [] });
        } catch (error) {
            console.error('[cms] the rich text editor could not load', error);
            this.failed = __('The editor could not load. Reload the page to try again.');
        } finally { this.busy = false; }
    }

    /** The room's document, asked for a few times while the connection settles; null when the room stays out of reach. */
    @Client()
    private async sharedDocument(collab: RichTextCollabProps): Promise<{ doc: RichTextDoc | null; version: number } | null> {
        for (let attempt = 0; attempt < 5; attempt++) {
            try { return await collab.transport.document(); }
            catch { await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1))); }
        }
        this.collabRetryAt = Date.now() + 5000;
        return null;
    }

    onCleanup() {
        this.handle?.destroy();
        if (richTextEditors.get(this.props.id) === this.handle) richTextEditors.delete(this.props.id);
        if (this.props.collab && collabEditors.get(this.props.collab.path) === this.handle) collabEditors.delete(this.props.collab.path);
    }

    @Client()
    private run(command: RichTextCommand) {
        this.handle?.run(command);
    }

    @Client()
    private bind(name: string) {
        this.handle?.insertText(`{{ $.${name} }}`);
        this.handle?.focus();
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
                ${this.props.bindings?.length ? component(DropdownMenu, { id: `${this.props.id}-bind`, side: 'bottom', align: 'end', 'aria-label': __('Show a field of the entry'), title: __('Show a field of the entry'),
                    disabled: !this.ready, class: 'inline-flex h-7 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-4',
                    trigger: component(Icon, { entry: icon('database'), size: 16 }) }, html`
                    <p class="px-2 py-1.5 text-xs text-muted-foreground">${__('Show the value of')}</p>
                    ${this.props.bindings.map(choice => html`<button type="button" role="menuitem" tabindex="-1" class="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted cursor-pointer border-none bg-transparent"
                        @click=${() => this.bind(choice.name)}><span class="truncate">${choice.label}</span><code class="shrink-0 text-xs text-muted-foreground">{{ $.${choice.name} }}</code></button>`)}`) : null}
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
