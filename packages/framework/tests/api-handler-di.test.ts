import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack, CossackService, Inject, Page, Server, Service, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

const { registry } = vi.hoisted(() => ({ registry: { pages: {} as Record<string, unknown>, layouts: {} as Record<string, unknown>, loadings: {} } }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [async (c: any, next: () => Promise<void>) => {
    c.set('user', c.env?.TEST_USER); await next();
}] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

let disposed = 0;

@Service()
class Greeting extends CossackService {
    @State() text = 'hello from layout';
    onDispose() { disposed++; }
}

@Service()
class Clock extends CossackService {
    now() { return 42; }
}

@Page({ services: [Greeting] })
class Layout extends Cossack {
    render() { return html`${this.children}`; }
}

@Page({ transport: 'http' })
class GreetApi extends Cossack {
    @Inject(Greeting) greeting!: Greeting;
    constructor(public clock: Clock) { super(); }
    async get() { return this.c.json({ text: this.greeting.text, now: this.clock.now(), user: this.user?.id ?? null }); }
    @Server({ authorize: (_input: unknown, { context }: { context: any }) => context.get('user')?.role === 'admin' })
    async post() { return this.c.json({ saved: true }); }
}
Reflect.defineMetadata('design:paramtypes', [Clock], GreetApi);

// A page whose only HTTP verbs come from an inherited framework-level default.
@Page({ transport: 'http' })
class PlainPage extends Cossack {
    render() { return html`<p>plain</p>`; }
}

registry.layouts['/src/pages/layout.ts'] = { default: Layout };
registry.pages['/src/pages/api/greet.ts'] = { default: GreetApi };
registry.pages['/src/pages/plain/index.ts'] = { default: PlainPage };
const { createApp } = await import('../src/router');

afterEach(() => { disposed = 0; });

describe('class-based HTTP handlers', () => {
    it('constructs handlers through DI with layout service scopes and request facilities', async () => {
        const response = await createApp().request('/api/greet', {}, { TEST_USER: { id: 'u1' } } as any);
        expect(response.status, await response.clone().text()).toBe(200);
        expect(await response.json()).toEqual({ text: 'hello from layout', now: 42, user: 'u1' });
        // The request-local scope and its services are released after the handler.
        expect(disposed).toBe(1);
    });

    it.each([
        [{ id: 'u1', role: 'member' }, 403],
        [{ id: 'u2', role: 'admin' }, 200],
    ] as const)('honours @Server({ authorize }) on HTTP verb handlers (%o)', async (user, status) => {
        const response = await createApp().request('/api/greet', { method: 'POST' }, { TEST_USER: user } as any);
        expect(response.status).toBe(status);
        if (status === 403) expect(await response.json()).toMatchObject({ code: 'COSSACK_AUTH_FORBIDDEN' });
        else expect(await response.json()).toEqual({ saved: true });
    });

    it('does not expose verbs inherited from the framework base class as routes', async () => {
        const proto = Cossack.prototype as any;
        proto.patch = function () { return new Response('framework default'); };
        try {
            const response = await createApp().request('/plain', { method: 'PATCH' }, {} as any);
            expect(response.status).toBe(404);
            expect(await response.text()).not.toContain('framework default');
        } finally {
            delete proto.patch;
        }
    });
});
