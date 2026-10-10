import { describe, it, expect } from 'vitest';
import { renderToString } from '@cossackframework/renderer';
import { Icon, normalizeStyle } from '../src/icons/Icon';
import type { IconEntry } from '@cossackframework/solar-icons/types';
import { ArrowRightIcon } from '@cossackframework/solar-icons/arrow-right';

function renderEntry(entry: IconEntry | undefined, props: Record<string, unknown> = {}): string {
    const instance = new Icon();
    instance.props = { entry, ...props } as Icon['props'];
    return renderToString(instance.render());
}

describe('Icon native SVG contract', () => {
    it('renders real imported artwork with owned geometry and decorative defaults', () => {
        const out = renderEntry(ArrowRightIcon);
        expect(out).toContain('<svg');
        expect(out).toContain('width="24"');
        expect(out).toContain('height="24"');
        expect(out).toContain('viewBox="0 0 24 24"');
        expect(out).toContain('aria-hidden="true"');
        expect(out).toContain('focusable="false"');
        expect(out).toContain('<path');
        expect(out).not.toContain('role="img"');
    });
    it('separates artwork variant from native CSS style', () => {
        const out = renderEntry(ArrowRightIcon, { variant: 'bold', style: 'color: red', size: 32, fill: 'blue' });
        expect(out).toContain('fill="currentColor"');
        expect(out).toContain('style="color: red"');
        expect(out).toContain('width="32"');
        expect(out).toContain('fill="blue"');
        expect(out).not.toContain('fill="none"');
    });
    it('falls back to own line artwork only when the requested variant is absent', () => {
        expect(renderEntry({ line: '<path id="fallback" />' }, { variant: 'bold' })).toContain('id="fallback"');
        expect(() => renderEntry({ line: '<path/>', bold: '' }, { variant: 'bold' })).toThrow('nonempty');
        expect(() => renderEntry(Object.create({ line: '<path/>' }))).toThrow('nonempty');
    });
    it('names informative icons and escapes labels and native attribute values', () => {
        const text = 'A & B " <script>alert(1)</script>';
        const out = renderEntry(ArrowRightIcon, { label: text, class: 'x" onload="alert(1)', 'data-note': '&copy; <x>' });
        expect(out).toContain('role="img"');
        expect(out).not.toContain('aria-hidden="true"');
        expect(out).not.toContain('<script>');
        expect(out).toContain('&amp;');
        expect(out).toContain('&quot;');
        expect(out).not.toContain(' onload="');
        expect(out).toContain('&amp;copy;');
    });
    it.each([undefined, {}, []])('rejects missing artwork %j', entry => {
        expect(() => renderEntry(entry as IconEntry)).toThrow();
    });
    it.each([0, -1, NaN, Infinity, '24'])('rejects invalid size %j', size => {
        expect(() => renderEntry(ArrowRightIcon, { size })).toThrow('positive and finite');
    });
    it('rejects malformed names, unknown variants and positional children', () => {
        expect(() => renderEntry(ArrowRightIcon, { label: 42 })).toThrow('label');
        expect(() => renderEntry(ArrowRightIcon, { variant: 'nonsense' })).toThrow('Unsupported');
        const instance = new Icon();
        instance.props = { entry: ArrowRightIcon };
        instance.children = 'child';
        expect(() => instance.render()).toThrow('children');
    });
    it('treats blank labels as decoration', () => {
        const out = renderEntry(ArrowRightIcon, { label: '  ' });
        expect(out).toContain('aria-hidden="true"');
        expect(out).not.toContain('<title');
    });
});

describe('normalizeStyle', () => {
    it.each([['linear', 'line'], ['solid', 'bold'], ['d', 'duotone'], ['brk', 'broken'], ['o', 'outline'], ['ld', 'line-duotone'], [' BOLD ', 'bold']])('normalizes %s', (input, expected) => {
        expect(normalizeStyle(input)).toBe(expected);
    });
    it('rejects unknown styles', () => expect(() => normalizeStyle('nonsense')).toThrow('Unsupported'));
});
