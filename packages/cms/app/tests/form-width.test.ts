import { describe, expect, it, vi } from 'vitest';
import type { RenderedBlock } from '@cossackframework/cms';
import { FORM_BLOCKS } from '../../src/form-builder';

vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('__', (value: string) => value);
const { inputBlock } = await import('../src/cms/form-view');
const { renderToString } = await import('@cossackframework/renderer/server');

const input = (type: string, data: Record<string, unknown>, kind = 'string'): RenderedBlock => ({
    _id: String(data.name), type, data, html: {}, media: {},
    input: { key: String(data.name), name: String(data.name), id: `f-${data.name}`, kind, value: '', error: '', options: [] },
} as unknown as RenderedBlock);

describe('form input width', () => {
    it('is a setting of every input block, full by default', () => {
        for (const block of FORM_BLOCKS.filter(declaration => declaration.input)) {
            expect(block.fields.width, block.name).toMatchObject({ default: 'full' });
        }
    });

    it('marks an input that shares its row, and leaves a full-width one unmarked', async () => {
        const half = await renderToString(inputBlock(input('form/text', { name: 'name', label: 'Full Name', width: 'half' }))!);
        expect(half).toMatch(/<div class="cms-field space-y-1" data-input="name" data-width="half">/);
        const third = await renderToString(inputBlock(input('form/select', { name: 'topic', label: 'Topic', width: 'third' }, 'choice'))!);
        expect(third).toContain('data-width="third"');
        const full = await renderToString(inputBlock(input('form/email', { name: 'email', label: 'Email', width: 'full' }, 'email'))!);
        expect(full).not.toContain('data-width');
        const unknown = await renderToString(inputBlock(input('form/text', { name: 'other', label: 'Other', width: 'quarter' }))!);
        expect(unknown).not.toContain('data-width');
    });
});
