// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack, CossackService, Inject, Service, ServiceScope, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { render } from '../src/index';
import { controlledAsync } from '../src/server';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('browser lifecycle helper', () => {
    it('hydrates real component state, handles DOM actions and preserves scoped DI', async () => {
        class Counter extends CossackService { count = 4; }
        Service()(Counter);
        State()(Counter.prototype, 'count');
        class Component extends Cossack {
            name = 'default';
            counter!: Counter;
            render() { return html`<input .value=${this.name} @input=${(event: Event) => { this.name = (event.target as HTMLInputElement).value; }} /><button @click=${() => this.counter.count++}>${this.name}:${this.counter.count}</button>`; }
        }
        State()(Component.prototype, 'name');
        Inject(Counter)(Component.prototype, 'counter');
        const scope = new ServiceScope(undefined, [Counter]);
        const result = await render(Component, { state: { public: { name: 'hydrated' } }, serviceScope: scope, ownsServiceScope: true });
        expect(result.container.textContent).toBe('hydrated:4');
        expect(result.instance.counter).toBe(scope.resolveDeclared(Counter));
        await result.type('input', 'edited');
        await result.click('button');
        expect(result.container.textContent).toBe('edited:5');
        await result.unmount();
        expect(document.body.children).toHaveLength(0);
    });

    it('awaits async component/service cleanup once and removes the DOM even after failure', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const gate = controlledAsync<void>();
        const calls: string[] = [];
        class Resource { onDispose() { calls.push('service'); } }
        Service()(Resource);
        class Component extends Cossack {
            render() { return html`ready`; }
            async onCleanup() { calls.push('component:start'); await gate.promise; calls.push('component:end'); throw new Error('cleanup'); }
        }
        const result = await render(Component, { serviceScope: new ServiceScope(undefined, [Resource]), ownsServiceScope: true });
        const first = result.unmount();
        expect(result.unmount()).toBe(first);
        expect(calls).toEqual(['component:start']);
        gate.resolve();
        await expect(first).rejects.toBeInstanceOf(AggregateError);
        expect(calls).toEqual(['component:start', 'component:end', 'service']);
        expect(document.body.children).toHaveLength(0);
    });

    it('cleans failed bootstrap without leaving a mounted DOM', async () => {
        const cleaned = vi.fn();
        class Broken extends Cossack {
            render() { return html`broken`; }
            async bootstrap() { throw new Error('bootstrap failed'); }
            onCleanup() { cleaned(); }
        }
        await expect(render(Broken)).rejects.toThrow('bootstrap failed');
        expect(cleaned).toHaveBeenCalledOnce();
        expect(document.body.children).toHaveLength(0);
    });

    it('disposes an explicitly owned scope when component construction fails', async () => {
        const disposed = vi.fn();
        class Resource { onDispose() { disposed(); } }
        Service()(Resource);
        class Broken extends Cossack { constructor() { super(); throw new Error('construction failed'); } }
        await expect(render(Broken, { serviceScope: new ServiceScope(undefined, [Resource]), ownsServiceScope: true }))
            .rejects.toThrow('construction failed');
        expect(disposed).toHaveBeenCalledOnce();
        expect(document.body.children).toHaveLength(0);
    });
});
