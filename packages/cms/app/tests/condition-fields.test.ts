import { describe, expect, it } from 'vitest';
import { conditionFields } from '../src/cms/condition-control';
import type { BlockOption, EditorBlock } from '../src/cms/editor';

const options = [{ name: 'form/text', input: { kind: 'string' } }] as unknown as BlockOption[];
const block = (id: string, label: string): EditorBlock => ({ _id: id, type: 'form/text', data: { label } }) as EditorBlock;

describe('condition fields', () => {
    it('reads the same blocks once: the editor asks again on every keystroke', () => {
        const blocks = [block('a', 'Name'), block('b', 'Email')];
        const fields = conditionFields(blocks, options);
        expect(fields.map(field => field.name)).toEqual(['name', 'email']);
        expect(conditionFields(blocks, options)).toBe(fields);
        expect(conditionFields(blocks, options, 'a').map(field => field.name)).toEqual(['email']);
        expect(conditionFields(blocks, options)).toBe(fields);
    });

    it('reads blocks again when they are replaced', () => {
        const blocks = [block('a', 'Name')];
        const fields = conditionFields(blocks, options);
        const renamed = [{ ...blocks[0]!, data: { label: 'Full name' } }];
        expect(conditionFields(renamed, options).map(field => field.name)).toEqual(['fullName']);
        expect(conditionFields(blocks, options)).toBe(fields);
    });
});
