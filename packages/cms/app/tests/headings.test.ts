import { describe, expect, it } from 'vitest';
import type { RenderedBlock } from '@cossackframework/cms';
import { headingAnchor, withHeadingAnchors } from '../src/cms/headings';
import { remaining } from '../src/cms/countdown.client';

const heading = (id: string, text: string, level = 'h2', extra: Partial<RenderedBlock> = {}): RenderedBlock => ({ _id: id, type: 'core/heading', data: { text, level }, html: {}, media: {}, ...extra });
const paragraph = (id: string): RenderedBlock => ({ _id: id, type: 'core/paragraph', data: { text: 'x' }, html: { text: '<p>x</p>' }, media: {} });

describe('headings of an entry', () => {
    it('makes anchors from heading text', () => {
        expect(headingAnchor('Getting started')).toBe('getting-started');
        expect(headingAnchor('2026 in review')).toBe('h-2026-in-review');
        expect(headingAnchor('???')).toBe('section');
        expect(headingAnchor('x'.repeat(80)).length).toBeLessThanOrEqual(60);
    });

    it('anchors every heading, keeps anchors of their own, and fills the tables of contents', () => {
        const content = withHeadingAnchors([
            { _id: 'toc', type: 'core/toc', data: { title: 'Contents' }, html: {}, media: {} },
            heading('a', 'Intro'),
            paragraph('p'),
            { _id: 'g', type: 'core/group', data: {}, html: {}, media: {}, children: [heading('b', 'Details', 'h3'), heading('c', 'Intro', 'h3')] },
            heading('d', 'Pricing', 'h2', { layout: { anchor: 'cost', className: 'lead' } }),
        ]);
        expect(content[0]!.headings).toEqual([
            { id: 'intro', text: 'Intro', level: 2 }, { id: 'details', text: 'Details', level: 3 }, { id: 'intro-2', text: 'Intro', level: 3 }, { id: 'cost', text: 'Pricing', level: 2 },
        ]);
        expect(content[1]!.layout).toEqual({ anchor: 'intro' });
        expect(content[3]!.children![1]!.layout).toEqual({ anchor: 'intro-2' });
        expect(content[4]!.layout).toEqual({ anchor: 'cost', className: 'lead' });
        // Nothing to do: the same blocks come back.
        const plain = [paragraph('p1'), paragraph('p2')];
        expect(withHeadingAnchors(plain)).toEqual(plain);
    });
});

describe('a countdown', () => {
    it('splits what is left into days, hours, minutes and seconds', () => {
        const now = Date.UTC(2026, 0, 1);
        expect(remaining(now + ((2 * 86_400 + 3 * 3600 + 4 * 60 + 5) * 1000), now)).toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5 });
        expect(remaining(now + 999, now)).toBeNull();
        expect(remaining(now - 1, now)).toBeNull();
    });
});
