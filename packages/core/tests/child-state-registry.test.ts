// @vitest-environment jsdom
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { component, html, render, pushCurrentInstance, popCurrentInstance } from '@cossackframework/renderer';
import { Cossack } from '../src/shared/cossack';
import { State } from '../src/shared/decorators';

const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('restored child state registry', () => {
    it('applies a restored child state at most once on the client', () => {
        class Item extends Cossack {
            @State() label = 'default';
        }
        class Host extends Cossack {}
        const host = new Host();
        host._id = 'page';
        (host as any)._childrenStateRegistry = { 'page:0': { public: { label: 'restored' } } };

        const first = new Item();
        first._id = 'page:0';
        host.registerComponent(first);
        expect(first.label).toBe('restored');

        // A later child that happens to get the same id must start fresh.
        const second = new Item();
        second._id = 'page:0';
        host.registerComponent(second);
        expect(second.label).toBe('default');
    });

    it('does not restore one sibling state into a conditionally inserted child', async () => {
        const rendered: Record<string, Cossack> = {};
        class Child extends Cossack {
            @State() label = 'default';
            declare props: { name: string };
            render() {
                rendered[this.props.name] = this;
                return html`<span>${this.props.name}=${this.label}</span>`;
            }
        }
        class Host extends Cossack {
            showA = false;
            render() {
                return html`<div>${this.showA ? component(Child, { name: 'A' }) : null}${component(Child, { name: 'B' })}</div>`;
            }
        }
        const host = new Host();
        host._id = 'page';
        // SSR rendered without A: B was `page:0`.
        (host as any)._childrenStateRegistry = { 'page:0': { public: { label: 'b-from-ssr' } } };

        const container = document.createElement('div');
        // Render the host the way its update loop does: reset the child
        // counter and render with the host as the owner of component() calls.
        const paint = () => {
            host.resetRenderState();
            pushCurrentInstance(host);
            try { render(host.render(), container); } finally { popCurrentInstance(); }
        };

        paint();
        await flush();
        expect(rendered.B._id).toBe('page:0');
        expect((rendered.B as any).label).toBe('b-from-ssr');

        host.showA = true;
        paint();
        await flush();
        expect(rendered.A._id).not.toBe(rendered.B._id);
        expect((rendered.A as any).label).toBe('default');
        expect(container.textContent).toBe('A=defaultB=b-from-ssr');
        host.destroy();
    });
});
