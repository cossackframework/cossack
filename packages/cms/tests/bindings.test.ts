import { describe, expect, it } from 'vitest';
import { bindingPaths, bindingText, bindingValue, hasBinding, resolveBindings, resolveBlockBindings, withBinding } from '../src/index';

const scope = { title: 'Rocket skates', price: 19.5, onSale: true, tags: ['fast', 'wheels'], specs: [{ name: 'Weight', value: '1.2 kg' }], image: 'file-1' };

describe('block bindings', () => {
    it('recognises whole-value and inline bindings', () => {
        expect(hasBinding('$.price')).toBe(true);
        expect(hasBinding('  $.specs.0.name ')).toBe(true);
        expect(hasBinding('Only {{ $.price }} today')).toBe(true);
        expect(hasBinding('$price')).toBe(false);
        expect(hasBinding(19.5)).toBe(false);
        expect(bindingPaths('$.price')).toEqual(['price']);
        expect(bindingPaths('{{ $.title }} for {{$.price}}')).toEqual(['title', 'price']);
    });

    it('walks dotted paths through objects and lists', () => {
        expect(bindingValue(scope, 'price')).toBe(19.5);
        expect(bindingValue(scope, 'specs.0.name')).toBe('Weight');
        expect(bindingValue(scope, 'specs.name')).toBeUndefined();
        expect(bindingValue(scope, 'missing.deep')).toBeUndefined();
    });

    it('renders values as text', () => {
        expect(bindingText(19.5)).toBe('19.5');
        expect(bindingText(true)).toBe('true');
        expect(bindingText(['fast', 'wheels'])).toBe('fast, wheels');
        expect(bindingText({ name: 'x' })).toBe('');
        expect(bindingText(null)).toBe('');
    });

    it('resolves a value against the scope', () => {
        expect(resolveBindings('$.title', scope)).toBe('Rocket skates');
        expect(resolveBindings('Only {{ $.price }} for {{ $.title }}', scope)).toBe('Only 19.5 for Rocket skates');
        expect(resolveBindings('{{ $.missing }}!', scope)).toBe('!');
        expect(resolveBindings('plain text', scope)).toBe('plain text');
    });

    it('resolves only the named text fields of a block', () => {
        const data = { text: '$.title', caption: '{{ $.price }} each', image: '$.image', level: 'h2' };
        expect(resolveBlockBindings(data, ['text', 'caption'], scope)).toEqual({ text: 'Rocket skates', caption: '19.5 each', image: '$.image', level: 'h2' });
        expect(resolveBlockBindings({ text: 'static' }, ['text'], scope)).toEqual({ text: 'static' });
    });

    it('writes a binding into a control value', () => {
        expect(withBinding('', 'price')).toBe('$.price');
        expect(withBinding('Price:', 'price')).toBe('Price: {{ $.price }}');
        expect(withBinding('Price: ', 'price')).toBe('Price: {{ $.price }}');
    });
});
