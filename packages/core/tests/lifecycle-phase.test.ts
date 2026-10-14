// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from 'hono';
import { CossackElement, component, html, render, renderToString } from '@cossackframework/renderer';
import { Cossack } from '../src/shared/cossack';
import { LifecyclePhase } from '../src/shared/component-types';
import { State } from '../src/shared/decorators';

const settle = async (turns = 20) => {
    for (let i = 0; i < turns; i++) await Promise.resolve();
};

const emptyState = { public: {}, private: {}, metadata: {} } as any;

afterEach(() => { vi.restoreAllMocks(); });

describe('lifecycle phase', () => {
    it('moves a bootstrapped client page Creating → Bootstrapping → Mounted ⇄ Updating → Destroyed', async () => {
        const seen: string[] = [];
        class Page extends Cossack {
            protected override isServer = false;
            @State() count = 0;
            override onMount() { seen.push(`mount:${this.getPhase()}`); }
            render() { return html`<p>${this.count}</p>`; }
        }
        // Cossack.willUpdate() enters Updating, then calls the renderer's willUpdate.
        vi.spyOn(CossackElement.prototype, 'willUpdate').mockImplementation(function (this: CossackElement) {
            if (this instanceof Page) seen.push(`update:${this.getPhase()}`);
        });
        const container = document.createElement('div');
        const page = new Page();
        expect(page.getPhase()).toBe(LifecyclePhase.Creating);

        await page.bootstrap({ container, initialState: emptyState });
        // onMount runs inside bootstrap(); the page then rests in Mounted.
        expect(page.getPhase()).toBe(LifecyclePhase.Mounted);
        await settle();
        expect(container.textContent).toBe('0');
        expect(page.getPhase()).toBe(LifecyclePhase.Mounted);

        page.count = 1;
        await settle();
        expect(container.textContent).toBe('1');
        expect(page.getPhase()).toBe(LifecyclePhase.Mounted);
        expect(seen).toEqual(['mount:Bootstrapping', 'update:Updating', 'update:Updating']);

        page.destroy();
        expect(page.getPhase()).toBe(LifecyclePhase.Destroyed);
    });

    it('reports Mounted for a component() child after it connects and between updates', async () => {
        const children: Cossack[] = [];
        class Child extends Cossack {
            @State() label = 'a';
            constructor() { super(); children.push(this); }
            render() { return html`<span>${this.label}</span>`; }
        }
        const container = document.createElement('div');
        render(html`<div>${component(Child, {})}</div>`, container);
        await settle();
        const [child] = children;
        expect(container.textContent).toBe('a');
        expect(child.getPhase()).toBe(LifecyclePhase.Mounted);

        (child as Child).label = 'b';
        await settle();
        expect(container.textContent).toBe('b');
        expect(child.getPhase()).toBe(LifecyclePhase.Mounted);

        // Removing the child destroys it.
        render(html`<div></div>`, container);
        expect(child.getPhase()).toBe(LifecyclePhase.Destroyed);
    });

    it('returns to Creating when bootstrap fails', async () => {
        class Broken extends Cossack {
            protected override isServer = true;
            render() { return html``; }
        }
        const broken = new Broken();
        // The server bootstrap requires a request context.
        await expect(broken.bootstrap({})).rejects.toThrow(/Context must be provided/);
        expect(broken.getPhase()).toBe(LifecyclePhase.Creating);
    });

    it('reports Mounted for a bootstrapped server page and its rendered children', async () => {
        const children: Cossack[] = [];
        class Child extends Cossack {
            protected override isServer = true;
            constructor() { super(); children.push(this); }
            render() { return html`<span>child</span>`; }
        }
        class Page extends Cossack {
            protected override isServer = true;
            render() { return html`<main>${component(Child, {})}</main>`; }
        }
        const page = new Page();
        await page.bootstrap({ context: new Context(new Request('http://localhost/')) as any, skipGet: true, skipInit: true });
        expect(page.getPhase()).toBe(LifecyclePhase.Mounted);
        expect(renderToString(page.render()!)).toContain('<span>child</span>');
        expect(children[0].getPhase()).toBe(LifecyclePhase.Mounted);
        page.destroy();
        expect(page.getPhase()).toBe(LifecyclePhase.Destroyed);
    });
});
