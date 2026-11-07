import { describe, expect, it } from 'vitest';
import { blockProblems, CORE_BLOCKS, manifestProblems } from '../src/index';

const base = { schemaVersion: 1, name: 'acme', version: '1.0.0' };

describe('what a theme or plugin adds to the block library', () => {
    it('ships patterns of core blocks and its own', () => {
        const pattern = { slug: 'contact-card', title: 'Contact card', blocks: [{ _id: 'h', type: 'core/heading', data: { text: 'Talk to us', level: 'h2' } }, { _id: 'c', type: 'acme/contact', data: { email: 'hi@acme.test' } }] };
        const manifest = { ...base, blocks: [{ name: 'acme/contact', label: 'Contact', fields: { email: { kind: 'string', required: true, max: 120, label: 'Email' } } }], patterns: [pattern] };
        expect(manifestProblems(manifest)).toEqual([]);
        expect(manifestProblems({ ...manifest, patterns: [{ ...pattern, synced: true, starter: ['pages'] }] })).toEqual([]);
        expect(manifestProblems({ ...manifest, patterns: [{ ...pattern, slug: 'Contact Card' }] })).toEqual(['patterns[0]: slug is 1 to 40 lowercase letters, digits and hyphens.']);
        expect(manifestProblems({ ...manifest, patterns: [pattern, pattern] })).toEqual(['pattern contact-card is declared twice.']);
        expect(manifestProblems({ ...manifest, patterns: [{ ...pattern, title: '' }] })).toEqual(['pattern contact-card: needs a title of at most 120 characters.']);
        expect(manifestProblems({ ...manifest, patterns: [{ ...pattern, blocks: [] }] })).toEqual(['pattern contact-card: needs at least one block.']);
        expect(manifestProblems({ ...manifest, patterns: [{ ...pattern, blocks: [{ _id: 'c', type: 'acme/contact', data: {} }] }] })).toEqual([expect.stringMatching(/^pattern contact-card: block c\.email /)]);
        expect(manifestProblems({ ...manifest, patterns: [{ ...pattern, blocks: [{ _id: 'x', type: 'other/thing', data: {} }] }] })).not.toEqual([]);
        expect(manifestProblems({ ...manifest, patterns: [{ ...pattern, starter: ['Pages'] }] })).toEqual(['pattern contact-card: starter lists collection names.']);
        expect(manifestProblems({ ...manifest, patterns: 'none' })).toEqual(['patterns[0] must be a pattern.']);
    });

    it('declares variations of a block type', () => {
        const block = { name: 'acme/card', label: 'Card', fields: { style: { kind: 'enum' as const, values: ['boxed', 'plain'], label: 'Style' } } };
        expect(blockProblems({ ...block, variations: [{ name: 'plain', label: 'Plain card', description: 'No box.', icon: 'star', keywords: ['flat'], data: { style: 'plain' } }] })).toEqual([]);
        expect(blockProblems({ ...block, variations: [{ name: 'Plain', label: 'Plain card', data: {} }] })).toEqual(['block acme/card: variations are named in lowercase with hyphens.']);
        expect(blockProblems({ ...block, variations: [{ name: 'a', label: 'A', data: {} }, { name: 'a', label: 'A', data: {} }] })).toEqual(['block acme/card: variation a is declared twice.']);
        expect(blockProblems({ ...block, variations: [{ name: 'a', label: 'A', data: { size: 'big' } }] })).toEqual(['block acme/card: variation a: data names size, which is not a field of the block.']);
        expect(blockProblems({ ...block, variations: [{ name: 'a', label: 'A', icon: 'Nope', data: {} }] })).toEqual(['block acme/card: variation a: icons are Solar icon names.']);
        expect(blockProblems({ ...block, variations: [{ name: 'a', label: '', data: {} }] })).toEqual(['block acme/card: variation a: needs a label of at most 80 characters.']);
        // Every core block, variations included, is valid; the group's are the hero and the row.
        for (const declaration of CORE_BLOCKS) expect(blockProblems(declaration), declaration.name).toEqual([]);
        expect(CORE_BLOCKS.find(declaration => declaration.name === 'core/group')!.variations!.map(variation => variation.name)).toEqual(['hero', 'row']);
    });
});
