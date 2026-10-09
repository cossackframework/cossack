// tests/action-queue.test.ts
import 'reflect-metadata';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
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

@Page({})
class QueueComponent extends Cossack<{}> {
    /** Records (_cossack_ws_context) before and after the await per action. */
    seen: unknown[] = [];

    @Server()
    async observe() {
        this.seen.push((this as any)._cossack_ws_context?.id);
        await new Promise(r => setTimeout(r, 20));
        this.seen.push((this as any)._cossack_ws_context?.id);
    }

    render(): TemplateResult {
        return { strings: [], values: [] } as unknown as TemplateResult;
    }
}

describe('executeAction serialization (WS context race fix)', () => {
    it('runs concurrent actions one at a time so each sees its own client context', async () => {
        const component = new QueueComponent();
        const clientA = makeClient('A');
        const clientB = makeClient('B');

        // Dispatch two actions concurrently (do NOT await between them).
        const pA = component.executeAction('observe', [], undefined, clientA as any);
        const pB = component.executeAction('observe', [], undefined, clientB as any);

        await Promise.all([pA, pB]);

        // Each action observed its own context both before AND after its await —
        // proving actions did not interleave and _cossack_ws_context was not
        // overwritten mid-action by the other client.
        expect(component.seen).toEqual(['A', 'A', 'B', 'B']);
    });

    it('uses each caller identity for this.user and context across awaits, including guests', async () => {
        class IdentityComponent extends QueueComponent {
            @Server()
            async identity(...args: unknown[]) {
                expect(args).toHaveLength(1);
                this.seen.push([this.user?.id, this.c.get('user')?.id]);
                await Promise.resolve();
                this.seen.push([this.user?.id, this.c.get('user')?.id]);
            }
        }
        const component = new IdentityComponent();
        (component as any)._user = { id: 'initial-admin' };
        (component as any)._c = { get: () => ({ id: 'initial-admin' }) };
        await Promise.all([
            component.executeAction('identity', [{ id: 'forged-admin' }], { id: 'member' }, makeClient('A')),
            component.executeAction('identity', [{ id: 'forged-admin' }], undefined, makeClient('B')),
        ]);
        expect(component.seen).toEqual([
            ['member', 'member'], ['member', 'member'], [undefined, undefined], [undefined, undefined],
        ]);
        expect((component as any).user.id).toBe('initial-admin');
    });

    it('always sends action-complete and swallows action errors (error boundary)', async () => {
        @Page({})
        class ThrowingComponent extends Cossack<{}> {
            @Server()
            async boom() {
                throw new Error('kaboom');
            }
            render(): TemplateResult {
                return { strings: [], values: [] } as unknown as TemplateResult;
            }
        }
        const component = new ThrowingComponent();
        const client = makeClient('A');
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Should not throw out of executeAction (would be an unhandled rejection).
        await expect(
            component.executeAction('boom', [], undefined, client as any),
        ).resolves.toBeUndefined();

        // action-complete is still sent so the client's loading counter releases.
        expect(client.sent.some(m => m.includes('action-complete'))).toBe(true);
        errSpy.mockRestore();
    });

    it('rejects non-@Server actions (allowlist still enforced)', async () => {
        const component = new QueueComponent();
        const client = makeClient('A');
        // 'toString' is not an @Server method.
        await component.executeAction('toString', [], undefined, client as any);
        expect(client.sent.length).toBe(0);
    });
});

describe('streaming actions without an async identity scope', () => {
    it('keeps the queue for the whole stream so identities stay correct', async () => {
        let resume!: () => void;
        const parked = new Promise<void>(resolve => { resume = resolve; });
        class SerialComponent extends QueueComponent {
            @Server()
            async *feed() { yield this.user?.id; await parked; return this.user?.id; }
            @Server()
            async whoami() { await Promise.resolve(); return this.user?.id; }
        }
        const component = new SerialComponent();
        const clientA = makeClient('A'), clientB = makeClient('B');
        const stream = component.executeAction('feed', [], { id: 'alice' }, clientA as any, 'stream-a');
        const normal = component.executeAction('whoami', [], { id: 'bob' }, clientB as any, 'call-b');
        await vi.waitFor(() => expect(clientA.sent).toHaveLength(1));
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(clientB.sent).toHaveLength(0);
        resume();
        await Promise.all([stream, normal]);
        expect(clientA.sent.map(data => JSON.parse(data).value)).toEqual(['alice', 'alice']);
        expect(clientB.sent.map(data => JSON.parse(data).value)).toEqual(['bob']);
    });
});

describe('detached streams with a scope that does not cross awaits (escaped async context)', () => {
    // Synchronous-only scope: models reads that escaped the async context, so
    // the fail-closed guard is what protects identity after an await.
    let current: ActionIdentity | undefined;
    beforeEach(() => {
        setActionIdentityScope({
            run(identity, fn) { const previous = current; current = identity; try { return fn(); } finally { current = previous; } },
            get: () => current,
        });
    });
    afterEach(() => { setActionIdentityScope(null); current = undefined; });

    it('does not let a long-lived stream from one client block or relabel another client action', async () => {
        let resume!: () => void;
        const parked = new Promise<void>(resolve => { resume = resolve; });
        let closed = false;
        class StreamComponent extends QueueComponent {
            @Server()
            async *feed() {
                const owner = this.user?.id;
                try {
                    yield ['start', owner, (this as any)._cossack_ws_context?.id];
                    // Synchronous segment after resume runs with the stream caller identity.
                    yield ['resumed', this.user?.id, (this as any)._cossack_ws_context?.id];
                    await parked; // never-ending until the test resumes it
                    yield ['late', owner];
                } finally { closed = true; }
            }
            @Server()
            async whoami() {
                const user = this.user; // synchronous read: unambiguous
                this.seen.push(['B', user?.id, (this as any)._cossack_ws_context?.id]);
                await Promise.resolve();
                try { this.seen.push(['B-after-await', this.user?.id]); }
                catch (error) { this.seen.push(['B-after-await', (error as Error).message.includes('ambiguous') ? 'refused' : 'other']); }
                return user?.id;
            }
        }
        const component = new StreamComponent();
        const clientA = makeClient('A');
        const clientB = makeClient('B');
        const stream = component.executeAction('feed', [], { id: 'alice' }, clientA as any, 'stream-a');
        const normal = component.executeAction('whoami', [], { id: 'bob' }, clientB as any, 'call-b');
        let normalDone = false;
        normal.then(() => { normalDone = true; });
        await vi.waitFor(() => expect(normalDone).toBe(true));
        const framesB = clientB.sent.map(data => JSON.parse(data));
        expect(framesB).toEqual([expect.objectContaining({ type: 'done', requestId: 'call-b', value: 'bob' })]);
        // While A's stream runs, B's post-await read is refused rather than guessed.
        expect(component.seen).toEqual([['B', 'bob', 'B'], ['B-after-await', 'refused']]);
        const framesA = () => clientA.sent.map(data => JSON.parse(data));
        expect(framesA().map(frame => frame.value)).toEqual([['start', 'alice', 'A'], ['resumed', 'alice', 'A']]);
        expect(closed).toBe(false);
        // Identity slots are released while the stream is parked.
        expect((component as any)._actionIdentity).toBeUndefined();
        expect((component as any)._cossack_ws_context).toBeUndefined();
        resume();
        await stream;
        expect(framesA().slice(2).map(frame => [frame.type, frame.value])).toEqual([['yield', ['late', 'alice']], ['done', undefined]]);
        expect(closed).toBe(true);
        // Once no stream is detached, ordinary actions read identity after awaits again.
        component.seen.length = 0;
        await component.executeAction('whoami', [], { id: 'carol' }, makeClient('C') as any, 'call-c');
        expect(component.seen).toEqual([['B', 'carol', 'C'], ['B-after-await', 'carol']]);
    });

    it('never gives a stream another caller identity after an await while that caller runs', async () => {
        let releaseStream!: () => void;
        const streamGate = new Promise<void>(resolve => { releaseStream = resolve; });
        let releaseB!: () => void;
        const bGate = new Promise<void>(resolve => { releaseB = resolve; });
        let bRunning = false;
        const observed: unknown[] = [];
        class LeakComponent extends QueueComponent {
            @Server()
            async *feed() {
                yield 'ready';
                await streamGate; // resumes while B owns the identity slots
                try { observed.push(['stream', this.user?.id]); }
                catch (error) { observed.push(['stream', (error as Error).message.includes('ambiguous') ? 'refused' : 'other']); }
                try { observed.push(['stream-c', this.c?.get('user')?.id]); }
                catch { observed.push(['stream-c', 'refused']); }
                yield 'after';
            }
            @Server()
            async slow() {
                bRunning = true;
                await bGate;
                bRunning = false;
            }
        }
        const component = new LeakComponent();
        (component as any)._c = { get: () => undefined };
        const clientA = makeClient('A');
        const stream = component.executeAction('feed', [], { id: 'alice' }, clientA as any, 'stream-a');
        const b = component.executeAction('slow', [], { id: 'bob' }, makeClient('B') as any, 'call-b');
        await vi.waitFor(() => expect(bRunning).toBe(true));
        expect((component as any)._actionIdentity.user.id).toBe('bob');
        releaseStream();
        await vi.waitFor(() => expect(observed).toHaveLength(2));
        expect(observed).toEqual([['stream', 'refused'], ['stream-c', 'refused']]);
        releaseB();
        await Promise.all([stream, b]);
        expect(clientA.sent.map(data => JSON.parse(data).value)).toEqual(['ready', 'after', undefined]);
    });

});
