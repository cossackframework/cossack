// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { component, html } from '@cossackframework/renderer';
import { Cossack } from '../src/shared/cossack';
import { On } from '../src/shared/decorators';

const settle = async (turns = 20) => {
    for (let i = 0; i < turns; i++) await Promise.resolve();
};

const emptyState = { public: {}, private: {}, metadata: {} } as any;

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('@On on nested components', () => {
    it('does not install a document-wide listener for a component() child', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const clicks: string[] = [];
        class Item extends Cossack {
            declare props: { label: string };
            @On('click')
            onClick() { clicks.push(this.props.label); }
            render() { return html`<li>${this.props.label}</li>`; }
        }
        class Page extends Cossack {
            protected override isServer = false;
            render() {
                return html`<ul>${component(Item, { label: 'a' })}${component(Item, { label: 'b' })}</ul>`;
            }
        }
        const container = document.createElement('div');
        const outside = document.createElement('button');
        document.body.appendChild(container);
        document.body.appendChild(outside);
        const page = new Page();
        await page.bootstrap({ container, initialState: emptyState });
        await settle();

        outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(clicks).toEqual([]);
        expect(warn.mock.calls.some(([msg]) => String(msg).includes("@On('click')"))).toBe(true);
        await page.destroy();
    });

    it('keeps document delegation for bootstrapped page components without a container', async () => {
        let clicks = 0;
        class Page extends Cossack {
            protected override isServer = false;
            @On('click')
            onClick() { clicks++; }
            render() { return html`<p>page</p>`; }
        }
        const page = new Page();
        await page.bootstrap({ initialState: emptyState });
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(clicks).toBe(1);
        await page.destroy();
    });
});
