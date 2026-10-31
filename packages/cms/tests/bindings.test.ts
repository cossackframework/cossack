import { describe, expect, it } from 'vitest';
import { bindingPaths, bindingProblem, bindingRefs, bindingText, bindingValue, hasBinding, resolveBindings, resolveBlockBindings, usesUserBinding, withBinding } from '../src/index';

const entry = { title: 'Rocket skates', price: 19.5, onSale: true, tags: ['fast', 'wheels'], specs: [{ name: 'Weight', value: '1.2 kg' }], image: 'file-1' };
const scope = { entry };

describe('block bindings', () => {
    it('recognises inline bindings only', () => {
        expect(hasBinding('{{ $.price }}')).toBe(true);
        expect(hasBinding('Only {{ $.specs.0.name }} today')).toBe(true);
        // A bare path is plain text: words and markup can surround a value only inside braces.
        expect(hasBinding('$.price')).toBe(false);
        expect(hasBinding('$price')).toBe(false);
        expect(hasBinding(19.5)).toBe(false);
        expect(bindingPaths('$.price')).toEqual([]);
        expect(bindingPaths('{{ $.title }} for {{$.price}}')).toEqual(['title', 'price']);
    });

    it('walks dotted paths through objects and lists', () => {
        expect(bindingValue(entry, 'price')).toBe(19.5);
        expect(bindingValue(entry, 'specs.0.name')).toBe('Weight');
        expect(bindingValue(entry, 'specs.name')).toBeUndefined();
        expect(bindingValue(entry, 'missing.deep')).toBeUndefined();
    });

    it('renders values as text', () => {
        expect(bindingText(19.5)).toBe('19.5');
        expect(bindingText(true)).toBe('true');
        expect(bindingText(['fast', 'wheels'])).toBe('fast, wheels');
        expect(bindingText({ name: 'x' })).toBe('');
        expect(bindingText(null)).toBe('');
    });

    it('resolves a value against the scope', () => {
        expect(resolveBindings('{{ $.title }}', scope)).toBe('Rocket skates');
        expect(resolveBindings('$.title', scope)).toBe('$.title');
        expect(resolveBindings('Only {{ $.price }} for {{ $.title }}', scope)).toBe('Only 19.5 for Rocket skates');
        expect(resolveBindings('{{ $.missing }}!', scope)).toBe('!');
        expect(resolveBindings('plain text', scope)).toBe('plain text');
    });

    it('resolves only the named text fields of a block', () => {
        const data = { text: '**{{ $.title }}**', caption: '{{ $.price }} each', image: '{{ $.image }}', level: 'h2' };
        expect(resolveBlockBindings(data, ['text', 'caption'], scope)).toEqual({ text: '**Rocket skates**', caption: '19.5 each', image: '{{ $.image }}', level: 'h2' });
        expect(resolveBlockBindings({ text: 'static' }, ['text'], scope)).toEqual({ text: 'static' });
    });

    it('reads the site and the signed-in user through their scopes', () => {
        const scopes = { entry, site: { title: 'Acme', tagline: 'Fast things' }, user: { name: 'Ada' } };
        expect(hasBinding('{{ $site.title }}')).toBe(true);
        expect(bindingRefs('{{ $.price }} at {{ $site.title }} for {{ $user.name }}')).toEqual([{ scope: '', path: 'price' }, { scope: 'site', path: 'title' }, { scope: 'user', path: 'name' }]);
        expect(bindingPaths('{{ $site.title }} {{ $.price }}')).toEqual(['price']);
        expect(resolveBindings('{{ $site.title }}: {{ $.title }}, for {{ $user.name }}', scopes)).toBe('Acme: Rocket skates, for Ada');
        // A visitor, or a widget away from any entry: those bindings render empty.
        expect(resolveBindings('Hi {{ $user.name }}{{ $.title }}', { site: scopes.site })).toBe('Hi ');
        expect(usesUserBinding('Hi {{ $user.name }}')).toBe(true);
        expect(usesUserBinding('{{ $site.title }}')).toBe(false);
    });

    it('refuses unknown scopes', () => {
        expect(bindingProblem('{{ $site.title }} {{ $user.name }} {{ $.price }}')).toBeUndefined();
        expect(bindingProblem('{{ $page.title }}')).toMatch(/unknown scope/);
        expect(resolveBindings('[{{ $page.title }}]', scope)).toBe('[]');
    });

    it('writes a binding into a control value', () => {
        expect(withBinding('', 'price')).toBe('{{ $.price }}');
        expect(withBinding('Price:', 'price')).toBe('Price: {{ $.price }}');
        expect(withBinding('Price: ', 'price')).toBe('Price: {{ $.price }}');
    });
});
