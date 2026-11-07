// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { MenuItemView } from '@cossackframework/cms';

vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('__', (value: string) => value);
const { closeMenusOnFollow, menuNav } = await import('../src/cms/site-view');
const { html, renderToString } = await import('@cossackframework/renderer/server');

const item = (id: string, label: string, url: string | null, extra: Partial<MenuItemView> = {}): MenuItemView =>
    ({ id, label, url, kind: url === null ? 'heading' : 'link', newTab: false, description: '', className: '', attributes: {}, fields: {}, panel: null, children: [], ...extra });
const helpers = { block: () => html``, isActive: () => false };
const click = (target: Element, init: MouseEventInit = {}) => target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));

describe('closeMenusOnFollow', () => {
    it('closes the drawer, drops focus and marks the nav closed when a link in it is followed, until the pointer leaves the item or focus returns', async () => {
        document.body.innerHTML = await renderToString(menuNav([item('about', 'About', '/about', { children: [item('team', 'Team', '/about/team', { newTab: true })] }), item('blog', 'Blog', '/blog')], {}, helpers)!);
        const stop = closeMenusOnFollow(document);
        const nav = document.querySelector('nav.cms-nav')!;
        const drawer = document.querySelector<HTMLDetailsElement>('details.cms-nav-mobile')!;
        const fold = document.querySelector<HTMLDetailsElement>('details.cms-nav-fold')!;
        const about = nav.querySelector<HTMLAnchorElement>('.cms-nav-list a[href="/about"]')!;
        drawer.open = true;
        fold.open = true;
        about.focus();
        expect(document.activeElement).toBe(about);
        click(about);
        expect(nav.hasAttribute('data-closed')).toBe(true);
        expect(drawer.open).toBe(false);
        expect(fold.open).toBe(false);
        expect(document.activeElement).not.toBe(about);
        // The pointer leaving the item clears the mark; so does focus coming back.
        about.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: about.closest('.cms-nav-sub, .cms-nav-item') }));
        expect(nav.hasAttribute('data-closed')).toBe(true);
        about.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
        expect(nav.hasAttribute('data-closed')).toBe(false);
        nav.setAttribute('data-closed', '');
        about.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        expect(nav.hasAttribute('data-closed')).toBe(false);
        // A modifier click, a new-tab link, a link outside a menu and a click in Live Edit (inside a marker) are left alone.
        drawer.open = true;
        click(about, { metaKey: true });
        click(nav.querySelector('.cms-nav-sub a[href="/about/team"]')!);
        expect(nav.hasAttribute('data-closed')).toBe(false);
        expect(drawer.open).toBe(true);
        document.body.insertAdjacentHTML('beforeend', '<a id="outside" href="/elsewhere">Elsewhere</a>');
        click(document.getElementById('outside')!);
        expect(drawer.open).toBe(true);
        document.body.innerHTML = `<div data-cms-doc="area:header">${document.body.innerHTML}</div>`;
        const edited = document.querySelector<HTMLDetailsElement>('details.cms-nav-mobile')!;
        edited.open = true;
        click(document.querySelector('nav.cms-nav .cms-nav-list a[href="/about"]')!);
        expect(edited.open).toBe(true);
        expect(document.querySelector('nav.cms-nav')!.hasAttribute('data-closed')).toBe(false);
        // Stopped: a followed link changes nothing.
        stop();
        document.body.innerHTML = await renderToString(menuNav([item('blog', 'Blog', '/blog')], {}, helpers)!);
        click(document.querySelector('nav.cms-nav .cms-nav-list a')!);
        expect(document.querySelector('nav.cms-nav')!.hasAttribute('data-closed')).toBe(false);
    });
});
