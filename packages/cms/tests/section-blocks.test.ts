import { describe, expect, it } from 'vitest';
import { blockProblems, CORE_BLOCKS, field, fieldProblems, MAP_EMBED_URL, SITE_ICON_NAMES, ICON_NAME_SET, validateBlocks, validateValue, type Block } from '../src/index';
import { brandIcon } from '../src/server/brands';

const types = new Map(CORE_BLOCKS.map(block => [block.name, block]));

describe('section blocks', () => {
    it('declares the leaf widgets of page builders as valid core blocks', () => {
        for (const name of ['core/spacer', 'core/accordion', 'core/accordion-item', 'core/icon-list', 'core/icon-item', 'core/testimonial', 'core/stat', 'core/pricing', 'core/social-links', 'core/map', 'core/tabs', 'core/tab']) {
            const declaration = types.get(name);
            expect(declaration, name).toBeTruthy();
            expect(blockProblems(declaration!), name).toEqual([]);
        }
        expect(types.get('core/accordion')!.children).toEqual({ allowed: ['core/accordion-item'], max: 30 });
        expect(types.get('core/icon-item')!.parent).toEqual(['core/icon-list']);
        expect(types.get('core/card')!.fields.icon).toMatchObject({ kind: 'string', icon: true });
        expect(types.get('core/social-links')!.fields.links).toMatchObject({ kind: 'string', multiple: true, brand: true });
    });

    it('validates a page of section blocks', () => {
        const page: Block[] = [
            { _id: 'tabs', type: 'core/tabs', data: {}, children: [
                { _id: 't1', type: 'core/tab', data: { label: 'Plans', icon: 'tag' }, children: [{ _id: 'p1', type: 'core/pricing', data: { name: 'Pro', price: '$29', period: 'per month', features: ['Everything', 'Support'], buttonLabel: 'Buy', buttonUrl: '/buy', highlighted: true, badge: 'Most popular' } }] },
                { _id: 't2', type: 'core/tab', data: { label: 'Reviews' }, children: [{ _id: 'q1', type: 'core/testimonial', data: { text: 'Great', name: 'Ada', role: 'CTO', rating: 5 } }] },
            ] },
            { _id: 'acc', type: 'core/accordion', data: { single: true }, children: [{ _id: 'a1', type: 'core/accordion-item', data: { label: 'Shipping', open: true }, children: [{ _id: 'a1p', type: 'core/paragraph', data: { text: 'Free' } }] }] },
            { _id: 'list', type: 'core/icon-list', data: { columns: 2 }, children: [{ _id: 'i1', type: 'core/icon-item', data: { icon: 'bolt', text: 'Fast' } }] },
            { _id: 'stat', type: 'core/stat', data: { value: '1,250', suffix: '+', label: 'Customers' } },
            { _id: 'social', type: 'core/social-links', data: { links: ['https://x.com/acme', 'mailto:hi@acme.test'] } },
            { _id: 'map', type: 'core/map', data: { address: 'Hanoi, Vietnam', zoom: 12 } },
            { _id: 'space', type: 'core/spacer', data: { size: 'large' } },
        ];
        expect(validateBlocks(page, types).errors).toEqual({});
        // An icon outside the site set, a stat that is not a number, an embed URL from elsewhere, a section outside its accordion.
        expect(validateBlocks([{ _id: 'c', type: 'core/card', data: { title: 'Fast', icon: 'rocket-ship-9000' } }], types).errors).toEqual({ 'c.icon': 'is not a known icon.' });
        expect(validateBlocks([{ _id: 's', type: 'core/stat', data: { value: '24/7' } }], types).errors).toEqual({ 's.value': 'has an invalid format.' });
        expect(validateBlocks([{ _id: 'm', type: 'core/map', data: { url: 'https://evil.example/maps/embed?pb=1' } }], types).errors).toEqual({ 'm.url': 'has an invalid format.' });
        expect(validateBlocks([{ _id: 'a1', type: 'core/accordion-item', data: { label: 'Loose' } }], types).errors).not.toEqual({});
    });

    it('keeps icon and brand fields to strings and the site icon set', () => {
        expect(fieldProblems('icon', field.icon({ label: 'Icon' }))).toEqual([]);
        expect(fieldProblems('icon', { kind: 'integer', icon: true, label: 'Icon' })).toEqual(['field icon: icon applies to string fields.']);
        expect(fieldProblems('link', { kind: 'text', brand: true, label: 'Link' })).toEqual(['field link: brand applies to string fields.']);
        expect(validateValue('icon', field.icon(), 'star')).toBeUndefined();
        expect(validateValue('icon', field.icon(), '')).toBeUndefined();
        expect(validateValue('icon', field.icon(), 'Star')).toBe('has an invalid format.');
        expect(validateValue('icon', field.icon(), 'not-an-icon')).toBe('is not a known icon.');
        expect(SITE_ICON_NAMES.length).toBeGreaterThan(100);
        expect(new Set(SITE_ICON_NAMES).size).toBe(SITE_ICON_NAMES.length);
        expect(ICON_NAME_SET.has("check-circle")).toBe(true);
    });

    it('accepts the embed URLs Google Maps and OpenStreetMap give', () => {
        expect(MAP_EMBED_URL.test('https://www.google.com/maps/embed?pb=!1m18!1m12')).toBe(true);
        expect(MAP_EMBED_URL.test('https://www.google.co.uk/maps/embed?pb=!1m18')).toBe(true);
        expect(MAP_EMBED_URL.test('https://maps.google.com/maps?q=Hanoi&output=embed')).toBe(true);
        expect(MAP_EMBED_URL.test('https://www.openstreetmap.org/export/embed.html?bbox=1,2,3,4&layer=mapnik')).toBe(true);
        expect(MAP_EMBED_URL.test('https://www.google.com.evil.example/maps/embed?pb=1')).toBe(false);
        expect(MAP_EMBED_URL.test('https://www.google.com/maps/place/Hanoi')).toBe(false);
        expect(MAP_EMBED_URL.test('javascript:alert(1)')).toBe(false);
    });

    it('names the network a profile URL belongs to, with its icon', () => {
        expect(brandIcon('https://x.com/acme')).toMatchObject({ title: 'X', hex: '000000' });
        expect(brandIcon('https://twitter.com/acme')?.title).toBe('X');
        expect(brandIcon('https://www.facebook.com/acme')?.title).toBe('Facebook');
        expect(brandIcon('https://m.facebook.com/acme')?.title).toBe('Facebook');
        expect(brandIcon('https://www.linkedin.com/company/acme')).toMatchObject({ title: 'LinkedIn', hex: '0A66C2' });
        expect(brandIcon('https://youtu.be/abc')?.title).toBe('YouTube');
        expect(brandIcon('https://wa.me/84900000000')?.title).toBe('WhatsApp');
        expect(brandIcon('https://fosstodon.org/@acme')?.title).toBe('Mastodon');
        expect(brandIcon('https://social.example/@acme')).toBeNull();
        expect(brandIcon('https://acme.example/feed')?.title).toBe('RSS');
        expect(brandIcon('mailto:hi@acme.test')).toBeNull();
        expect(brandIcon('not a url')).toBeNull();
        // A path is what the renderer draws; every icon has one.
        expect(brandIcon('https://github.com/acme')?.path).toMatch(/^M[\d.]/);
    });
});
