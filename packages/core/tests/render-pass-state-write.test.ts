// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { component, html } from '@cossackframework/renderer';
import { Cossack } from '../src/shared/cossack';
import { State } from '../src/shared/decorators';

const settle = async (turns = 20) => {
    for (let i = 0; i < turns; i++) await Promise.resolve();
};

const emptyState = { public: {}, private: {}, metadata: {} } as any;

afterEach(() => { vi.restoreAllMocks(); });

describe('state writes during a render pass', () => {
    it('re-renders when updated() writes state', async () => {
        class Page extends Cossack {
            protected override isServer = false;
            @State() count = 0;
            @State() derived = 0;
            override updated() {
                if (this.derived !== this.count * 2) this.derived = this.count * 2;
            }
            render() { return html`<p>${this.count}:${this.derived}</p>`; }
        }
        const container = document.createElement('div');
        const page = new Page();
        await page.bootstrap({ container, initialState: emptyState });
        expect(container.textContent).toBe('0:0');
        page.count = 2;
        await settle();
        expect(container.textContent).toBe('2:4');
        await page.destroy();
    });

    it('resolves the pending update promise only after the re-run committed', async () => {
        class Page extends Cossack {
            protected override isServer = false;
            @State() count = 0;
            @State() derived = 0;
            override updated() {
                if (this.derived !== this.count * 2) this.derived = this.count * 2;
            }
            render() { return html`<p>${this.count}:${this.derived}</p>`; }
        }
        const container = document.createElement('div');
        const page = new Page();
        await page.bootstrap({ container, initialState: emptyState });
        page.count = 3;
        await page.requestUpdate();
        expect(container.textContent).toBe('3:6');
        await page.destroy();
    });

    it('re-renders when a controller hostUpdated() writes state', async () => {
        class Page extends Cossack {
            protected override isServer = false;
            @State() count = 0;
            @State() seen = 0;
            render() { return html`<p>${this.count}:${this.seen}</p>`; }
        }
        const container = document.createElement('div');
        const page = new Page();
        page.addController({
            hostUpdated: () => { if (page.seen !== page.count) page.seen = page.count; },
        } as any);
        await page.bootstrap({ container, initialState: emptyState });
        page.count = 5;
        await settle();
        expect(container.textContent).toBe('5:5');
        await page.destroy();
    });

    it('re-renders the parent when a nested child onMount() calls a parent callback during the parent commit', async () => {
        class Child extends Cossack {
            declare props: { onReady: () => void };
            override onMount() { this.props.onReady(); }
            render() { return html`<span>child</span>`; }
        }
        class Page extends Cossack {
            protected override isServer = false;
            @State() show = false;
            @State() ready = false;
            markReady() { this.ready = true; }
            render() {
                return html`<p>${this.ready ? 'ready' : 'waiting'}</p>${this.show ? component(Child, { onReady: () => this.markReady() }) : ''}`;
            }
        }
        const container = document.createElement('div');
        const page = new Page();
        await page.bootstrap({ container, initialState: emptyState });
        expect(container.querySelector('p')!.textContent).toBe('waiting');
        page.show = true;
        await settle();
        expect(page.ready).toBe(true);
        expect(container.querySelector('p')!.textContent).toBe('ready');
        await page.destroy();
    });

    it('caps runaway re-renders and warns in development', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let renders = 0;
        class Page extends Cossack {
            protected override isServer = false;
            @State() count = 0;
            override updated() { this.count++; }
            render() { renders++; return html`<p>${this.count}</p>`; }
        }
        const container = document.createElement('div');
        const page = new Page();
        await page.bootstrap({ container, initialState: emptyState });
        const before = renders;
        page.count = 100;
        await settle(400);
        expect(renders - before).toBeGreaterThan(1);
        expect(renders - before).toBeLessThan(200);
        expect(warn.mock.calls.some(([msg]) => String(msg).includes('re-render'))).toBe(true);
        await page.destroy();
    });
});
