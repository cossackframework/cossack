// tests/action-queue.test.ts
import 'reflect-metadata';
import { vi, describe, it, expect } from 'vitest';

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
