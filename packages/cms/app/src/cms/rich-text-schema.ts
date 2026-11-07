/**
 * The rich text document contract as TipTap extensions, shared by the editor in the browser
 * and the entry room on the server, which applies editors' steps to the same schema. Only the
 * nodes and marks the host accepts are registered, so pasted content is reduced to them, and
 * links and images are filtered by the same URL rules as on save. Node views, which need a
 * document, are added by the editor alone (`rich-text.client.ts`).
 */
import { getSchema, Node, type Extensions, type NodeConfig } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { Document } from '@tiptap/extension-document';
import { Image } from '@tiptap/extension-image';
import { TextAlign } from '@tiptap/extension-text-align';
import { StarterKit } from '@tiptap/starter-kit';
import { safeImageUrl, safeLinkUrl, type EmbeddedBlock } from '@cossackframework/cms';

/** The block a `cmsBlock` node stands for. */
export function blockOf(node: { attrs: Record<string, unknown> }): EmbeddedBlock {
    return { _id: String(node.attrs._id), type: String(node.attrs.type), data: (node.attrs.data ?? {}) as EmbeddedBlock['data'] };
}

/** How the editor draws an embedded block: TipTap's node view factory. */
export type BlockView = NonNullable<NodeConfig['addNodeView']>;

/** Blocks as atoms between paragraphs. `view` adds the editor's card for one; without it the node renders its markup alone. */
export function cmsBlock(view?: BlockView) {
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
        ...(view ? { addNodeView: view } : {}),
    });
}

/** Images keep their media ID; pasted images from other sites are dropped unless they are https. */
export const MediaImage = Image.extend({
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

/** The extensions that define the document: the same list on both sides, so steps apply alike. */
export function richTextExtensions(block = cmsBlock()): Extensions {
    return [
        Document.extend({ content: '(block | cmsBlock)+' }),
        StarterKit.configure({
            document: false,
            heading: { levels: [2, 3, 4] },
            link: { openOnClick: false, autolink: true, defaultProtocol: 'https', isAllowedUri: url => safeLinkUrl(url), shouldAutoLink: url => safeLinkUrl(url) },
        }),
        TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'] }),
        MediaImage.configure({ inline: false, allowBase64: false }),
        block,
    ];
}

let schema: Schema | undefined;

/** The document schema, built once; the room applies steps to documents of this schema. */
export function richTextSchema(): Schema {
    return schema ??= getSchema(richTextExtensions());
}
