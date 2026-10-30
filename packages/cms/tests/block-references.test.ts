import { describe, expect, it } from 'vitest';
import { blockProblems, CORE_BLOCKS, hasBlockReference, parseBlockText, textBlocks, validateBlocks, type Block, type BlockDeclaration } from '../src/index';

const types = new Map<string, BlockDeclaration>(CORE_BLOCKS.map(block => [block.name, block]));

const blocks = (text: string) => {
    const parsed = parseBlockText(text, types, 'r');
    return { blocks: textBlocks(parsed), problems: parsed.problems, parts: parsed.parts };
};

describe('block references', () => {
    it('finds references and leaves bindings and other braces as text', () => {
        expect(hasBlockReference('Buy {{ block core/button label="Go" url="/" /}}')).toBe(true);
        expect(hasBlockReference('{{ pattern hero /}}')).toBe(true);
        expect(hasBlockReference('Only {{ $.price }}')).toBe(false);
        expect(hasBlockReference('\\{{ block core/button /}}')).toBe(false);
        const { parts, problems } = blocks('Price {{ $.price }} and {{ handlebars }}');
        expect(problems).toEqual([]);
        expect(parts).toEqual([{ kind: 'text', text: 'Price {{ $.price }} and {{ handlebars }}' }]);
    });

    it('parses a block without a body, keeping bindings inside quoted values', () => {
        const { parts, problems } = blocks('Before {{ block core/button label="Buy {{ $.title }} \\"now\\"" url="/cart" /}} after');
        expect(problems).toEqual([]);
        expect(parts).toEqual([
            { kind: 'text', text: 'Before ' },
            { kind: 'block', block: { _id: 'r1', type: 'core/button', data: { label: 'Buy {{ $.title }} "now"', url: '/cart' } } },
            { kind: 'text', text: ' after' },
        ]);
    });

    it('fills the body field of a leaf block, static text and bindings alike', () => {
        expect(blocks('{{ block core/button url="/" }} Price is {{ $.price }} {{ /block }}').blocks).toEqual([{ _id: 'r1', type: 'core/button', data: { url: '/', label: 'Price is {{ $.price }}' } }]);
        expect(blocks('{{ block core/button label="A" url="/" }}B{{ /block }}').problems).toEqual(['core/button gets label twice: as an attribute and as its body.']);
        expect(blocks('{{ block core/image }}text{{ /block }}').problems).toEqual(['core/image takes no body: write {{ block core/image … /}}.']);
    });

    it('nests containers: children from tags, loose text as paragraphs', () => {
        const { blocks: tree, problems } = blocks(`{{ block core/columns }}
  {{ block core/column }}
    From {{ $.price }}
    {{ block core/button label="Buy" url="/cart" /}}
  {{ /block core/column }}
  {{ block core/column }}Free shipping{{ /block }}
{{ /block }}`);
        expect(problems).toEqual([]);
        expect(tree).toHaveLength(1);
        const columns = tree[0]!;
        expect(columns.type).toBe('core/columns');
        expect(columns.children?.map(child => child.type)).toEqual(['core/column', 'core/column']);
        expect(columns.children?.[0]?.children?.map(child => [child.type, child.data])).toEqual([['core/paragraph', { text: 'From {{ $.price }}' }], ['core/button', { label: 'Buy', url: '/cart' }]]);
        expect(columns.children?.[1]?.children?.map(child => child.data)).toEqual([{ text: 'Free shipping' }]);
        // Every ID is distinct across the tree.
        const ids: string[] = [];
        const walk = (list: readonly Block[]) => list.forEach(block => { ids.push(block._id); walk(block.children ?? []); });
        walk(tree);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('refuses text where a container takes only some blocks', () => {
        expect(blocks('{{ block core/columns }}loose{{ /block }}').problems).toEqual(['core/columns holds only core/column: put the text in one of them.']);
    });

    it('reports wrong references and keeps the rest', () => {
        expect(blocks('{{ block core/nope /}}').problems).toEqual(['core/nope is not an available block.']);
        expect(blocks('{{ block core/faq /}}').problems).toEqual(['Questions and answers (core/faq) cannot be used in text.']);
        expect(blocks('{{ block core/button size=big /}}').problems[0]).toMatch(/needs quotes/);
        expect(blocks('{{ block core/button color="red" /}}').problems).toEqual(['core/button has no color.']);
        expect(blocks('{{ /block }}').problems).toEqual(['{{ /block }} closes no block.']);
        expect(blocks('{{ block core/group }}{{ /block core/column }}').problems[0]).toBe('{{ /block core/column }} closes core/group.');
        const open = blocks('A {{ block core/group }}text');
        expect(open.problems[0]).toMatch(/is not closed/);
        expect(open.parts).toEqual([{ kind: 'text', text: 'A text' }]);
    });

    it('names patterns by slug and writes escaped braces as text', () => {
        expect(blocks('{{ pattern hero /}}').blocks).toEqual([{ _id: 'r1', type: 'core/pattern', data: { pattern: 'hero' } }]);
        expect(blocks('\\{{ block core/button /}}').parts).toEqual([{ kind: 'text', text: '{{ block core/button /}}' }]);
    });

    it('limits nesting to the block depth', () => {
        const deep = '{{ block core/group }}'.repeat(6) + 'x' + '{{ /block }}'.repeat(6);
        expect(blocks(deep).problems.some(problem => /nest at most/.test(problem))).toBe(true);
    });

    it('checks references and binding scopes when blocks are saved', () => {
        const paragraph = (text: string) => validateBlocks([{ _id: 'p', type: 'core/paragraph', data: { text } }], types).errors;
        expect(paragraph('Buy {{ block core/button label="Go" url="/cart" /}} now {{ $site.title }}')).toEqual({});
        expect(paragraph('{{ block core/button label="Go" /}}')['p.text']).toMatch(/block reference is invalid: url is required/);
        expect(paragraph('{{ block core/faq /}}')['p.text']).toBe('Questions and answers (core/faq) cannot be used in text.');
        expect(validateBlocks([{ _id: 'h', type: 'core/heading', data: { text: '{{ $page.title }}', level: 'h2' } }], types).errors['h.text']).toMatch(/unknown scope/);
    });

    it('checks the inline and body declarations of block types', () => {
        const base = { name: 'acme/badge', label: 'Badge', fields: { text: { kind: 'string' as const }, image: { kind: 'string' as const, media: true } } };
        expect(blockProblems({ ...base, inline: true, body: 'text' }, 'acme')).toEqual([]);
        expect(blockProblems({ ...base, body: 'image' }, 'acme')).toEqual(['block acme/badge: body names one of its string or text fields.']);
    });
});
