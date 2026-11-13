import { describe, expect, it } from 'vitest';
import { CORE_BLOCKS, field, type Block, type BlockDeclaration, type RichTextDoc } from '@cossackframework/cms';
import { replaceableText, replaceInBlocks, replaceInDoc } from '../src/cms/replace';

const types = new Map<string, BlockDeclaration>(CORE_BLOCKS.map(block => [block.name, block]));

describe('find and replace', () => {
    it('removes text nodes it empties, and counts only what it changed', () => {
        const doc: RichTextDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read ' }, { type: 'text', text: 'Click here', marks: [{ type: 'link', attrs: { href: '/a' } }] }] }] };
        const result = replaceInDoc(doc, /Click here/g, '')!;
        expect(result.count).toBe(1);
        expect(result.value.content![0]!.content).toEqual([{ type: 'text', text: 'Read ' }]);
    });

    it('changes the text of blocks, not their links, choices or styles', () => {
        const blocks = [{ _id: 'b1', type: 'core/button', data: { label: 'Go left', url: '/left', style: 'primary' }, style: { align: 'left' } },
            { _id: 'b2', type: 'core/unknown', data: { text: 'left' } }] as unknown as Block[];
        const result = replaceInBlocks(blocks, types, /left/gi, 'right')!;
        expect(result.value[0]!.data).toMatchObject({ label: 'Go right', url: '/left' });
        expect(result.value[0]!.style).toEqual({ align: 'left' });
        expect(result.value[1]!.data).toEqual({ text: 'left' });
        expect(result.count).toBe(1);
    });

    it('leaves slugs, choices and code alone', () => {
        expect(replaceableText(field.string({ max: 80 }))).toBe(true);
        expect(replaceableText(field.text({ max: 80, format: 'markdown' }))).toBe(true);
        expect(replaceableText(field.string({ max: 80, pattern: '[a-z-]+' }))).toBe(false);
        expect(replaceableText(field.text({ max: 80, format: 'code' }))).toBe(false);
    });
});
