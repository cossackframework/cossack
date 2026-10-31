/**
 * Entries as Markdown, for agents and assistants that ask for `text/markdown`: rich text and
 * the core blocks become headings, paragraphs, lists, quotes, code and images. Client-safe.
 */
import { blockIsData, flattenBlocks, type Block, type BlockDeclaration } from './blocks';
import { richTextBlocks, safeImageUrl, safeLinkUrl, type RichTextDoc, type RichTextNode } from './richtext';

const escapeText = (text: string) => text.replace(/([\\`*_{}[\]<>])/g, '\\$1');

function inlineMarkdown(nodes: readonly RichTextNode[] = []): string {
    return nodes.map(node => {
        if (node.type === 'hardBreak') return '  \n';
        if (node.type !== 'text') return '';
        let text = node.text ?? '';
        const marks = node.marks ?? [];
        if (marks.some(mark => mark.type === 'code')) return `\`${text.replace(/`/g, '\\`')}\``;
        text = escapeText(text);
        if (marks.some(mark => mark.type === 'bold')) text = `**${text}**`;
        if (marks.some(mark => mark.type === 'italic')) text = `*${text}*`;
        if (marks.some(mark => mark.type === 'strike')) text = `~~${text}~~`;
        const link = marks.find(mark => mark.type === 'link');
        if (link && safeLinkUrl(link.attrs?.href)) text = `[${text}](${String(link.attrs!.href)})`;
        return text;
    }).join('');
}

function listMarkdown(node: RichTextNode, ordered: boolean, depth: number, media: (id: string) => string | null): string {
    const start = ordered && Number.isSafeInteger(node.attrs?.start) ? node.attrs!.start as number : 1;
    return (node.content ?? []).map((item, index) => {
        const marker = ordered ? `${start + index}. ` : '- ';
        const body = (item.content ?? []).map(child => nodeMarkdown(child, depth + 1, media)).filter(Boolean);
        const [first = '', ...rest] = body;
        const indent = ' '.repeat(marker.length);
        return `${'  '.repeat(depth)}${marker}${first.replace(/\n/g, `\n${indent}`)}${rest.map(part => `\n\n${part.split('\n').map(line => `${indent}${line}`).join('\n')}`).join('')}`;
    }).join('\n');
}

function nodeMarkdown(node: RichTextNode, depth: number, media: (id: string) => string | null): string {
    switch (node.type) {
        case 'paragraph': return inlineMarkdown(node.content);
        case 'heading': {
            const level = Number.isInteger(node.attrs?.level) ? Math.min(Math.max(node.attrs!.level as number, 1), 6) : 2;
            return `${'#'.repeat(level)} ${inlineMarkdown(node.content)}`;
        }
        case 'blockquote': return (node.content ?? []).map(child => nodeMarkdown(child, depth, media)).filter(Boolean).join('\n\n').split('\n').map(line => `> ${line}`).join('\n');
        case 'bulletList': return listMarkdown(node, false, depth, media);
        case 'orderedList': return listMarkdown(node, true, depth, media);
        case 'codeBlock': {
            const language = typeof node.attrs?.language === 'string' ? node.attrs.language.replace(/[^a-z0-9+#-]/gi, '') : '';
            return `\`\`\`${language}\n${(node.content ?? []).map(child => child.text ?? '').join('')}\n\`\`\``;
        }
        case 'horizontalRule': return '---';
        case 'image': {
            const mediaId = typeof node.attrs?.mediaId === 'string' ? node.attrs.mediaId : null;
            const src = (mediaId ? media(mediaId) : null) ?? node.attrs?.src;
            if (!safeImageUrl(src)) return '';
            return `![${escapeText(typeof node.attrs?.alt === 'string' ? node.attrs.alt : '')}](${String(src)})`;
        }
        default: return '';
    }
}

/** A rich text document as Markdown; embedded blocks render through `block`. */
export function richTextMarkdown(doc: RichTextDoc | null | undefined, options: { media?: (id: string) => string | null; block?: (block: Block) => string } = {}): string {
    if (!doc || !Array.isArray(doc.content)) return '';
    const media = options.media ?? (() => null);
    return doc.content.map(node => node.type === 'cmsBlock' ? options.block?.(richTextBlocks({ type: 'doc', content: [node] })[0]!) ?? '' : nodeMarkdown(node, 0, media)).filter(Boolean).join('\n\n');
}

/**
 * Blocks as Markdown: the core text and media blocks by shape, other blocks by their text
 * fields (as `blocksPlain` reads them). Data blocks and forms render nothing.
 */
export function blocksMarkdown(blocks: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>, options: { media?: (id: string) => string | null; mediaAlt?: (id: string) => string } = {}): string {
    const media = options.media ?? (() => null);
    const alt = options.mediaAlt ?? (() => '');
    const parts: string[] = [];
    const render = (block: Block): string => {
        const type = types.get(block.type);
        if (!type || blockIsData(type) || type.input) return '';
        const data = block.data;
        const text = (name: string) => typeof data[name] === 'string' ? data[name] as string : '';
        switch (block.type) {
            case 'core/richtext': return data.text && typeof data.text === 'object' ? richTextMarkdown(data.text as RichTextDoc, { media, block: render }) : '';
            case 'core/paragraph': return text('text');
            case 'core/heading': return `${'#'.repeat(Number(String(data.level ?? 'h2').slice(1)) || 2)} ${text('text')}`;
            case 'core/quote': return `${text('text').split('\n').map(line => `> ${line}`).join('\n')}${text('citation') ? `\n>\n> — ${text('citation')}` : ''}`;
            case 'core/list': return (Array.isArray(data.items) ? data.items as string[] : []).map((item, index) => `${data.ordered ? `${index + 1}. ` : '- '}${item}`).join('\n');
            case 'core/code': return `\`\`\`${text('language')}\n${text('code')}\n\`\`\``;
            case 'core/image': { const url = media(text('image')); return url ? `![${escapeText(alt(text('image')) || text('caption'))}](${url})${text('caption') ? `\n\n*${text('caption')}*` : ''}` : ''; }
            case 'core/gallery': return (Array.isArray(data.images) ? data.images as string[] : []).map(id => { const url = media(id); return url ? `![${escapeText(alt(id))}](${url})` : ''; }).filter(Boolean).join('\n\n');
            case 'core/button': return `[${text('label')}](${text('url')})`;
            case 'core/answer': return `${text('label') ? `**${text('label')}** ` : ''}${text('text')}`;
            case 'core/faq-item': return `### ${text('question')}\n\n${text('answer')}`;
            case 'core/step': return `### ${text('title')}${text('text') ? `\n\n${text('text')}` : ''}`;
            case 'core/claim': { const source = text('sourceUrl') ? `[${text('sourceName')}](${text('sourceUrl')})` : text('sourceName'); return `> ${text('text')}\n>\n> — ${source}${text('date') ? `, ${text('date')}` : ''}`; }
            case 'core/definition': return `**${text('term')}**: ${text('definition')}`;
            case 'core/divider': return '---';
            case 'core/card': return [text('title') ? `### ${text('title')}` : '', text('text'), text('url') ? `[${text('linkLabel') || text('url')}](${text('url')})` : ''].filter(Boolean).join('\n\n');
            default: {
                const fields = Object.entries(type.fields).flatMap(([name, declaration]) => {
                    const value = data[name];
                    if (declaration.kind === 'richtext' && value && typeof value === 'object') return [richTextMarkdown(value as RichTextDoc, { media, block: render })];
                    if ((declaration.kind === 'string' || declaration.kind === 'text') && typeof value === 'string' && !declaration.media && !declaration.pattern) return [value];
                    return [];
                });
                return fields.filter(part => part.trim()).join('\n\n');
            }
        }
    };
    for (const block of flattenBlocks(blocks)) {
        // Containers render through their children, which the flattening lists after them.
        if (block.children?.length && !['core/richtext'].includes(block.type)) continue;
        const text = render(block);
        if (text.trim()) parts.push(text.trim());
    }
    return parts.join('\n\n');
}

export interface EntryMarkdownInput {
    readonly title: string;
    readonly url: string;
    readonly site: string;
    readonly description?: string;
    readonly author?: string;
    readonly published?: string;
    readonly updated?: string;
    readonly terms?: readonly { readonly label: string; readonly terms: readonly string[] }[];
    readonly body: string;
}

/** One entry as a Markdown document with a front-matter header, the way agents read pages. */
export function entryMarkdown(input: EntryMarkdownInput): string {
    const quote = (value: string) => JSON.stringify(value);
    const header = [
        `title: ${quote(input.title)}`, `url: ${quote(input.url)}`, `site: ${quote(input.site)}`,
        ...(input.description ? [`description: ${quote(input.description)}`] : []), ...(input.author ? [`author: ${quote(input.author)}`] : []),
        ...(input.published ? [`published: ${input.published}`] : []), ...(input.updated ? [`updated: ${input.updated}`] : []),
        ...(input.terms ?? []).filter(group => group.terms.length).map(group => `${group.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}: [${group.terms.map(quote).join(', ')}]`),
    ];
    return `---\n${header.join('\n')}\n---\n\n# ${input.title}\n\n${input.description ? `${input.description}\n\n` : ''}${input.body}\n`;
}
