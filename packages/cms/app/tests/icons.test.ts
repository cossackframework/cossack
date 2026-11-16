// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetRequestContextForTests, setRequestContextGetter } from '@cossackframework/core';
import { renderToString } from '@cossackframework/renderer';
import { iconSpriteUrl } from '@cossackframework/cms';

vi.stubGlobal('__', (value: string) => value);
const { icon, ICON_CATALOG, ICON_STYLE_META, iconStyle, hasIcon, resetIconStyle } = await import('../src/cms/icons');
const { siteIcon } = await import('../src/cms/site-view');
const { shellIcons } = await import('../src/dashboard/icons');

afterEach(() => { __resetRequestContextForTests(); resetIconStyle(); document.head.replaceChildren(); });

describe('the icon style', () => {
    it('is line when nothing says otherwise', () => {
        expect(iconStyle()).toBe('line');
        expect(icon('eye')).toEqual({ href: `${iconSpriteUrl('line', 'hot')}#eye` });
    });

    it('is the page meta on the client, read once', () => {
        const meta = document.createElement('meta');
        meta.name = ICON_STYLE_META;
        meta.content = 'duotone';
        document.head.append(meta);
        expect(iconStyle()).toBe('duotone');
        meta.content = 'bold';
        expect(iconStyle()).toBe('duotone');
        resetIconStyle();
        meta.content = 'not-a-style';
        expect(iconStyle()).toBe('line');
    });

    it('follows the first icon the server drew when the page has no meta', () => {
        document.body.innerHTML = `<svg><use href="${iconSpriteUrl('broken', 'hot')}#eye"></use></svg>`;
        expect(iconStyle()).toBe('broken');
        document.body.innerHTML = '';
    });
});

describe('icons by name', () => {
    it('draw any catalog icon from its sprite, and a fallback for an unknown name', () => {
        expect(icon('asteroid')).toEqual({ href: `${iconSpriteUrl('line', 'astronomy')}#asteroid` });
        expect(icon('nope')).toEqual(icon('document-text'));
        expect(icon(undefined, 'widget-4')).toEqual({ href: `${iconSpriteUrl('line', 'hot')}#widget-4` });
        expect(hasIcon('asteroid')).toBe(true);
        expect(hasIcon('nope')).toBe(false);
        expect(hasIcon(undefined)).toBe(false);
    });

    it('offer the whole catalog to the picker', () => {
        expect(ICON_CATALOG.categories.length).toBeGreaterThan(30);
        expect(ICON_CATALOG.entry('asteroid')).toEqual(icon('asteroid'));
    });

    it('draw a site icon as a use into the sprite, decorative unless labelled, and nothing for an unknown name', () => {
        const plain = renderToString(siteIcon('check-circle')!);
        expect(plain).toContain(`<use href="${iconSpriteUrl('line', 'hot')}#check-circle"></use>`);
        expect(plain).toContain('class="cms-icon size-5"');
        expect(plain).toContain('aria-hidden="true"');
        const named = renderToString(siteIcon('asteroid', { class: 'size-8', label: 'Asteroid' })!);
        expect(named).toContain('role="img"');
        expect(named).toContain('aria-label="Asteroid"');
        expect(named).toContain(`${iconSpriteUrl('line', 'astronomy')}#asteroid`);
        expect(siteIcon('nope')).toBeNull();
    });
});

describe('the dashboard shell', () => {
    it('draws its own icons in the site style, from the hot sprite', () => {
        const meta = document.createElement('meta');
        meta.name = ICON_STYLE_META;
        meta.content = 'duotone';
        document.head.append(meta);
        const icons = shellIcons();
        for (const [key, name] of [['home', 'widget-2'], ['light', 'sun'], ['dark', 'moon'], ['logout', 'logout-3'], ['search', 'magnifier'], ['desktop', 'monitor']] as const)
            expect(icons[key]).toEqual({ href: `${iconSpriteUrl('duotone', 'hot')}#${name}` });
    });
});
