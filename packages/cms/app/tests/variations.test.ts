import { describe, expect, it } from 'vitest';
import { newBlock, type BlockOption } from '../src/cms/editor';

const option: BlockOption = { name: 'core/group', label: 'Group', description: '', icon: 'layers', category: 'design', fields: [], children: { allowed: [], max: null }, parent: [], supports: [], input: false, field: '', keywords: [], common: false,
    variations: [{ name: 'hero', label: 'Hero', description: '', icon: 'gallery-wide', keywords: [], data: { align: 'full', height: 'medium', valign: 'center' } }] };

describe('a new block from a variation', () => {
    it('starts with the variation\'s values over the defaults', () => {
        expect(newBlock('core/group', [option], () => 'g1', 'hero')).toEqual({ _id: 'g1', type: 'core/group', data: { align: 'full', height: 'medium', valign: 'center' }, children: [] });
        expect(newBlock('core/group', [option], () => 'g2')).toEqual({ _id: 'g2', type: 'core/group', data: {}, children: [] });
        expect(newBlock('core/group', [option], () => 'g3', 'no-such')).toEqual({ _id: 'g3', type: 'core/group', data: {}, children: [] });
    });
});
