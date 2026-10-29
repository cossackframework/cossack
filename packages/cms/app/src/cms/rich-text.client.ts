/**
 * The rich text editor: TipTap (ProseMirror) configured to the CMS document contract. The
 * `.client.ts` name keeps TipTap out of server bundles; the server receives a stub.
 * Only the nodes and marks the host accepts are registered, so pasted content is reduced to
 * them, and links and images are filtered by the same URL rules as on save.
 */
import { Editor, Node } from '@tiptap/core';
import { Document } from '@tiptap/extension-document';
import { Image } from '@tiptap/extension-image';
import { TextAlign } from '@tiptap/extension-text-align';
import { Placeholder } from '@tiptap/extensions';
import { StarterKit } from '@tiptap/starter-kit';
import { safeImageUrl, safeLinkUrl, type EmbeddedBlock, type RichTextDoc } from '@cossackframework/cms';

export type RichTextCommand =
    | 'paragraph' | 'heading2' | 'heading3' | 'heading4' | 'bold' | 'italic' | 'underline' | 'strike' | 'code'
    | 'bulletList' | 'orderedList' | 'blockquote' | 'codeBlock' | 'horizontalRule' | 'alignLeft' | 'alignCenter' | 'alignRight' | 'undo' | 'redo' | 'unlink';

export interface RichTextHandle {
    run(command: RichTextCommand): void;
    /** Link the selection, or the word at the cursor. */
    link(href: string, newTab: boolean): void;
    /** The link at the selection, for the link form. */
    linkAt(): { href: string; newTab: boolean } | null;
    insertImage(image: { src: string; alt: string; mediaId?: string }): void;
    insertLink(text: string, href: string): void;
    insertBlock(block: EmbeddedBlock): void;
    updateBlock(id: string, data: EmbeddedBlock['data']): void;
    /** Insert a document's content after the top-level node holding the cursor, such as a pattern's copy. */
    insertContent(doc: RichTextDoc): void;
    /** Replace an embedded block with a document's content, such as when detaching a synced pattern. */
    replaceBlock(id: string, doc: RichTextDoc): void;
    /** Replace the whole document from outside (a restored autosave, a saved entry), without reporting it as a change. */
    setContent(doc: RichTextDoc | null): void;
    focus(): void;
    destroy(): void;
}

export interface RichTextOptions {
    content: RichTextDoc | null;
    label: string;
    placeholder: string;
    /** Classes of the editable surface. */
    className: string;
    blockLabel(type: string): string;
    /** A line describing the block's content in the editor. */
    blockSummary(block: EmbeddedBlock): string;
    onChange(doc: RichTextDoc): void;
    /** Names of the formats active at the selection, for the toolbar. */
    onSelection(active: string[]): void;
    onEditBlock(block: EmbeddedBlock): void;
}

/** Blocks as atoms between paragraphs: a card with the block's name and Edit and Remove buttons. */
function cmsBlock(options: RichTextOptions) {
    return Node.create({
        name: 'cmsBlock',
        group: 'cmsBlock',
        atom: true,
        selectable: true,
        draggable: true,
        addAttributes() {
            return { _id: { default: null }, type: { default: null }, data: { default: {} } };
        },
        parseHTML() {
            return [{
                tag: 'div[data-cms-block]',
                getAttrs: element => {
                    try { return { _id: element.getAttribute('data-id'), type: element.getAttribute('data-type'), data: JSON.parse(element.getAttribute('data-data') ?? '{}') }; }
                    catch { return false; }
                },
            }];
        },
        renderHTML({ node }) {
            return ['div', { 'data-cms-block': '', 'data-id': node.attrs._id, 'data-type': node.attrs.type, 'data-data': JSON.stringify(node.attrs.data ?? {}) }];
        },
        addNodeView() {
            return ({ node: initial, editor, getPos }) => {
                let node = initial;
                const dom = document.createElement('div');
                dom.className = 'my-4 flex items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3 not-prose';
                dom.contentEditable = 'false';
                const text = document.createElement('div');
                text.className = 'min-w-0';
                const title = document.createElement('p');
                title.className = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground';
                const summary = document.createElement('p');
                summary.className = 'truncate text-sm text-foreground';
                text.append(title, summary);
                const actions = document.createElement('div');
                actions.className = 'flex shrink-0 gap-2';
                const button = (label: string, run: () => void) => {
                    const element = document.createElement('button');
                    element.type = 'button';
                    element.textContent = label;
                    element.className = 'rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-muted cursor-pointer';
                    element.addEventListener('click', event => { event.preventDefault(); run(); });
                    return element;
                };
                const edit = button(__('Edit'), () => options.onEditBlock(blockOf(node)));
                const remove = button(__('Remove'), () => {
                    const position = getPos();
                    if (typeof position === 'number') editor.chain().focus().deleteRange({ from: position, to: position + node.nodeSize }).run();
                });
                actions.append(edit, remove);
                dom.append(text, actions);
                const paint = () => {
                    const block = blockOf(node);
                    title.textContent = options.blockLabel(block.type);
                    summary.textContent = options.blockSummary(block);
                    edit.setAttribute('aria-label', `${__('Edit')} ${title.textContent}`);
                    remove.setAttribute('aria-label', `${__('Remove')} ${title.textContent}`);
                };
                paint();
                return {
                    dom,
                    update: updated => {
                        if (updated.type.name !== 'cmsBlock') return false;
                        node = updated;
                        paint();
                        return true;
                    },
                    selectNode: () => dom.classList.add('ring-2', 'ring-ring'),
                    deselectNode: () => dom.classList.remove('ring-2', 'ring-ring'),
                    stopEvent: event => event.target instanceof HTMLButtonElement,
                    ignoreMutation: () => true,
                };
            };
        },
    });
}

function blockOf(node: { attrs: Record<string, unknown> }): EmbeddedBlock {
    return { _id: String(node.attrs._id), type: String(node.attrs.type), data: (node.attrs.data ?? {}) as EmbeddedBlock['data'] };
}

/** Images keep their media ID; pasted images from other sites are dropped unless they are https. */
const MediaImage = Image.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            mediaId: {
                default: null,
                parseHTML: element => element.getAttribute('data-media-id'),
                renderHTML: attributes => attributes.mediaId ? { 'data-media-id': attributes.mediaId } : {},
            },
        };
    },
    parseHTML() {
        return [{ tag: 'img[src]', getAttrs: element => safeImageUrl(element.getAttribute('src')) ? null : false }];
    },
});

export function mountRichText(element: HTMLElement, options: RichTextOptions): RichTextHandle {
    const active = (editor: Editor) => [
        ...(['bold', 'italic', 'underline', 'strike', 'code', 'bulletList', 'orderedList', 'blockquote', 'codeBlock', 'link'] as const).filter(name => editor.isActive(name)),
        ...([2, 3, 4] as const).filter(level => editor.isActive('heading', { level })).map(level => `heading${level}`),
        ...(['center', 'right'] as const).filter(align => editor.isActive({ textAlign: align })).map(align => `align${align[0]!.toUpperCase()}${align.slice(1)}`),
    ];
    const editor = new Editor({
        element,
        extensions: [
            Document.extend({ content: '(block | cmsBlock)+' }),
            StarterKit.configure({
                document: false,
                heading: { levels: [2, 3, 4] },
                link: { openOnClick: false, autolink: true, defaultProtocol: 'https', isAllowedUri: url => safeLinkUrl(url), shouldAutoLink: url => safeLinkUrl(url) },
            }),
            TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'] }),
            Placeholder.configure({ placeholder: options.placeholder }),
            MediaImage.configure({ inline: false, allowBase64: false }),
            cmsBlock(options),
        ],
        content: options.content && options.content.content.length ? options.content as never : '',
        editorProps: { attributes: { class: options.className, 'aria-label': options.label, 'aria-multiline': 'true', role: 'textbox' } },
        onUpdate: ({ editor }) => options.onChange(editor.getJSON() as RichTextDoc),
        onSelectionUpdate: ({ editor }) => options.onSelection(active(editor)),
        onTransaction: ({ editor }) => options.onSelection(active(editor)),
    });
    const chain = () => editor.chain().focus();
    const find = (id: string): { position: number; size: number } | null => {
        let found: { position: number; size: number } | null = null;
        editor.state.doc.descendants((node, position) => {
            if (found) return false;
            if (node.type.name === 'cmsBlock' && node.attrs._id === id) found = { position, size: node.nodeSize };
            return !found;
        });
        return found;
    };
    return {
        run(command) {
            const run: Record<RichTextCommand, () => boolean> = {
                paragraph: () => chain().setParagraph().run(),
                heading2: () => chain().toggleHeading({ level: 2 }).run(),
                heading3: () => chain().toggleHeading({ level: 3 }).run(),
                heading4: () => chain().toggleHeading({ level: 4 }).run(),
                bold: () => chain().toggleBold().run(),
                italic: () => chain().toggleItalic().run(),
                underline: () => chain().toggleUnderline().run(),
                strike: () => chain().toggleStrike().run(),
                code: () => chain().toggleCode().run(),
                bulletList: () => chain().toggleBulletList().run(),
                orderedList: () => chain().toggleOrderedList().run(),
                blockquote: () => chain().toggleBlockquote().run(),
                codeBlock: () => chain().toggleCodeBlock().run(),
                horizontalRule: () => chain().setHorizontalRule().run(),
                alignLeft: () => chain().setTextAlign('left').run(),
                alignCenter: () => chain().setTextAlign('center').run(),
                alignRight: () => chain().setTextAlign('right').run(),
                undo: () => chain().undo().run(),
                redo: () => chain().redo().run(),
                unlink: () => chain().extendMarkRange('link').unsetLink().run(),
            };
            run[command]();
        },
        link(href, newTab) {
            if (!safeLinkUrl(href)) return;
            const attributes = { href, target: newTab ? '_blank' : null };
            if (editor.state.selection.empty && !editor.isActive('link')) chain().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: attributes }] }).run();
            else chain().extendMarkRange('link').setLink(attributes).run();
        },
        linkAt() {
            if (!editor.isActive('link')) return null;
            const attributes = editor.getAttributes('link');
            return { href: String(attributes.href ?? ''), newTab: attributes.target === '_blank' };
        },
        insertImage(image) {
            if (!safeImageUrl(image.src)) return;
            chain().insertContent({ type: 'image', attrs: { src: image.src, alt: image.alt, mediaId: image.mediaId ?? null } }).run();
        },
        insertLink(text, href) {
            if (!safeLinkUrl(href)) return;
            chain().insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }).run();
        },
        insertBlock(block) {
            // Blocks sit between top-level nodes: after the one holding the cursor.
            const { $from } = editor.state.selection;
            const position = $from.depth ? $from.after(1) : $from.pos;
            chain().insertContentAt(position, { type: 'cmsBlock', attrs: { _id: block._id, type: block.type, data: block.data } }).run();
        },
        updateBlock(id, data) {
            const found = find(id);
            if (!found) return;
            editor.chain().command(({ tr }) => {
                const node = tr.doc.nodeAt(found.position);
                if (!node) return false;
                tr.setNodeMarkup(found.position, undefined, { ...node.attrs, data });
                return true;
            }).run();
        },
        insertContent(doc) {
            const { $from } = editor.state.selection;
            const position = $from.depth ? $from.after(1) : $from.pos;
            chain().insertContentAt(position, doc.content).run();
        },
        replaceBlock(id, doc) {
            const found = find(id);
            if (found) chain().insertContentAt({ from: found.position, to: found.position + found.size }, doc.content).run();
        },
        setContent(doc) { editor.commands.setContent(doc && doc.content.length ? doc as never : '', { emitUpdate: false }); },
        focus() { editor.commands.focus(); },
        destroy() { editor.destroy(); },
    };
}
