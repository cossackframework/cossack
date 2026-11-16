/**
 * Validation messages about blocks name a block by its ID (`block b7b7b905cc24.label is required.`),
 * which nobody can find in a long tree. These helpers find the block the message is about and
 * say it in words: the block's label or field name, then the field. Client-safe.
 */
import { placeBlocks } from '@cossackframework/cms';
import type { BlockOption, EditorBlock } from './editor';

/** `block <id>` or `Block <id>` followed by an optional `.field`, as the CMS writes it. */
const BLOCK_PATH = /\b[Bb]lock ([a-z0-9]{6,32})(?:\.([A-Za-z_][A-Za-z0-9_]*))?(:)?/;

/** The block and field a message names, when it names one. */
export function blockErrorTarget(message: string | undefined): { id: string; field: string | null } | null {
    const match = message ? BLOCK_PATH.exec(message) : null;
    return match ? { id: match[1]!, field: match[2] ?? null } : null;
}

/** A block's name for people: its field name or label, else its type's label, else its type. */
export function blockName(block: EditorBlock, options: readonly BlockOption[]): string {
    const option = options.find(entry => entry.name === block.type);
    const name = typeof block.data.name === 'string' && block.data.name.trim() ? block.data.name.trim() : '';
    const label = typeof block.data.label === 'string' && block.data.label.trim() ? block.data.label.trim() : '';
    return option?.field ? name || label || option.label : label || option?.label || block.type;
}

/**
 * The message with the block ID replaced by the block's name and the field's label:
 * `Block "price".label is required.` instead of `Block b7b7b905cc24.label: is required.`.
 * Unknown IDs stay as they are.
 */
export function describeBlockError(message: string, blocks: readonly EditorBlock[], options: readonly BlockOption[]): string {
    const target = blockErrorTarget(message);
    if (!target) return message;
    const block = placeBlocks(blocks).find(place => place.block._id === target.id)?.block;
    if (!block) return message;
    const option = options.find(entry => entry.name === block.type);
    const field = target.field ? option?.fields.find(entry => entry.name === target.field)?.label ?? target.field : '';
    return message.replace(BLOCK_PATH, (_match, _id, _field, colon) => `${__('Block')} “${blockName(block, options)}”${field ? ` → ${field}` : ''}${colon ?? ''}`);
}

/** The IDs of the block a message names and of every container above it, so a tree can open them. */
export function blockErrorPath(message: string | undefined, blocks: readonly EditorBlock[]): Set<string> {
    const target = blockErrorTarget(message);
    const path = new Set<string>();
    if (!target) return path;
    const visit = (list: readonly EditorBlock[], ancestors: readonly string[]): boolean => {
        for (const block of list) {
            if (block._id === target.id) { for (const id of [...ancestors, block._id]) path.add(id); return true; }
            if (block.children && visit(block.children, [...ancestors, block._id])) return true;
        }
        return false;
    };
    visit(blocks, []);
    return path;
}
