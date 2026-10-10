// @vitest-environment node
// tests/action-identity-scope.test.ts
import 'reflect-metadata';
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { setActionIdentityScope, type ActionIdentity } from '../src/shared/action-identity-scope';

vi.mock('../src/shared/environment', () => ({ isServer: true }));

import { Cossack } from '../src/shared/cossack';
import { Server, Page } from '../src/shared/decorators';
import type { TemplateResult } from '@cossackframework/renderer';

vi.mock('@cossackframework/renderer', () => {
    const createContext = <T>(defaultValue: T) => ({ defaultValue, _id: Math.random().toString() });
    class CossackElement {
        render() { return null; }
        requestUpdate() {}
        mount() {}
        updated() {}
        connectedCallback() {}
        disconnectedCallback() {}
        static properties = {};
        autoBindMethods() {}
        consume() { return undefined; }
        provide() {}
        resetRenderState() {}
    }
    return {
        render: vi.fn(),
        renderToString: vi.fn(),
        html: (strings: any, ...values: any[]) => ({ strings, values }),
        CossackElement,
        createContext,
        isTemplateResult: vi.fn(() => true),
        pushCurrentInstance: vi.fn(),
        popCurrentInstance: vi.fn(),
        instanceStack: [],
    };
});

function makeClient(id: string) {
    return {
        id,
        readyState: 1, // OPEN
        sent: [] as string[],
        send(data: string) { this.sent.push(data); },
    };
}

const als = new AsyncLocalStorage<ActionIdentity>();
beforeAll(() => { setActionIdentityScope({ run: (identity, fn) => als.run(identity, fn), get: () => als.getStore() }); });
afterAll(() => { setActionIdentityScope(null); });

function gate() { let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); return { wait, release }; }

@Page({})
class SharedComponent extends Cossack<{}> {
    seen: unknown[] = [];
    streamGate = gate();
    bStarted = gate();
    bGate = gate();
    private socketId() { return (this as any)._cossack_ws_context?.id; }
    private who() { return this.user?.id; } // helper bound to the real instance

    @Server()
    async *feed() {
        yield ['start', this.user?.id];
        await this.streamGate.wait; // resumes while B owns the queue
        this.seen.push(['stream', this.user?.id, this.c.get('user')?.id, this.who()]);
        yield ['late', this.user?.id];
        await Promise.resolve();
        return this.who();
    }

    @Server()
    async slow() {
        this.bStarted.release();
        await this.bGate.wait;
        this.seen.push(['B', this.user?.id, this.c.get('user')?.id, this.who()]);
        return this.user?.id;
    }

    render(): TemplateResult {
        return { strings: [], values: [] } as unknown as TemplateResult;
    }
}

describe('async action-identity scope', () => {
    it('keeps each caller identity across awaits while a detached stream and a queued action interleave', async () => {
        const component = new SharedComponent();
        (component as any)._user = { id: 'initial-admin' };
        (component as any)._c = { get: () => ({ id: 'initial-admin' }) };
        const clientA = makeClient('A');
        const clientB = makeClient('B');
        const stream = component.executeAction('feed', [], { id: 'alice' }, clientA as any, 'stream-a');
        const b = component.executeAction('slow', [], { id: 'bob' }, clientB as any, 'call-b');
        await component.bStarted.wait; // B runs although A's stream is still open
        component.streamGate.release(); // A's generator continues during B's turn
        await vi.waitFor(() => expect(component.seen).toHaveLength(1));
        component.bGate.release(); // B continues after an await while A's stream is open
        await Promise.all([stream, b]);
        expect(component.seen).toEqual([
            ['stream', 'alice', 'alice', 'alice'],
            ['B', 'bob', 'bob', 'bob'],
        ]);
        const framesA = clientA.sent.map(data => JSON.parse(data));
        expect(framesA.map(frame => [frame.type, frame.value])).toEqual([
            ['yield', ['start', 'alice']], ['yield', ['late', 'alice']], ['done', 'alice'],
        ]);
        expect(clientB.sent.map(data => JSON.parse(data))).toEqual([expect.objectContaining({ type: 'done', value: 'bob' })]);
        expect((component as any).user.id).toBe('initial-admin');
    });
});
