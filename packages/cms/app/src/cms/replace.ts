/** Find and replace over entry values: the words people wrote, never IDs, links, choices or styles. */
import { blockIsData, type Block, type BlockDeclaration, type FieldDeclaration, type RichTextDoc, type RichTextNode } from '@cossackframework/cms';

export interface Replaced<T> { readonly value: T; readonly count: number }

/** Whether a field holds prose to search: plain or Markdown text, not a slug, URL, choice, reference, media or code. */
export function replaceableText(declaration: FieldDeclaration): boolean {
    if (declaration.kind !== 'string' && declaration.kind !== 'text') return false;
    return !declaration.media && !declaration.taxonomy && !declaration.multiple && !declaration.pattern && !declaration.choices && !declaration.choicesFrom
        && declaration.format !== 'code';
}

/** The fields find and replace reads and writes: prose, rich text and blocks, never the entry's password. */
export function replaceableFields(fields: { readonly [name: string]: FieldDeclaration }): [string, FieldDeclaration][] {
    return Object.entries(fields).filter(([name, declaration]) => name !== 'password' && (replaceableText(declaration) || declaration.kind === 'richtext' || declaration.kind === 'blocks'));
}

export function replaceInText(value: string, pattern: RegExp, replacement: string): Replaced<string> {
    let count = 0;
    const next = value.replace(pattern, () => { count++; return replacement; });
    return { value: next, count };
}

/** Text nodes the replacement empties are removed: a rich text document has no empty text nodes. */
export function replaceInDoc(doc: RichTextDoc | null, pattern: RegExp, replacement: string): Replaced<RichTextDoc> | null {
    if (!doc || !Array.isArray(doc.content)) return null;
    let count = 0;
    const visit = (node: RichTextNode): RichTextNode | null => {
        if (node.type === 'text' && typeof node.text === 'string') {
            const result = replaceInText(node.text, pattern, replacement);
            count += result.count;
            if (!result.count) return node;
            return result.value ? { ...node, text: result.value } : null;
        }
        return node.content ? { ...node, content: node.content.map(visit).filter((child): child is RichTextNode => child !== null) } : node;
    };
    const content = doc.content.map(visit).filter((node): node is RichTextNode => node !== null);
    return { value: { ...doc, content }, count };
}

/** Each block's text and rich text inputs, as its type declares them; blocks of an unknown or data type stay as they are. */
export function replaceInBlocks(blocks: Block[] | null, types: ReadonlyMap<string, BlockDeclaration>, pattern: RegExp, replacement: string): Replaced<Block[]> | null {
    if (!Array.isArray(blocks)) return null;
    let count = 0;
    const visit = (block: Block): Block => {
        const type = types.get(block.type);
        const data: Record<string, unknown> = { ...block.data };
        if (type && !blockIsData(type)) {
            for (const [name, declaration] of Object.entries(type.fields)) {
                const value = data[name];
                if (declaration.kind === 'richtext' && value && typeof value === 'object') {
                    const result = replaceInDoc(value as RichTextDoc, pattern, replacement);
                    if (result?.count) { data[name] = result.value; count += result.count; }
                } else if (typeof value === 'string' && replaceableText(declaration)) {
                    const result = replaceInText(value, pattern, replacement);
                    if (result.count) { data[name] = result.value; count += result.count; }
                }
            }
        }
        return { ...block, data, ...(block.children ? { children: block.children.map(visit) } : {}) };
    };
    return { value: blocks.map(visit), count };
}
