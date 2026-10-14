// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { html } from '@cossackframework/renderer';
import { Cossack } from '../src/shared/cossack';
import { Debounce, OnWindow } from '../src/shared/decorators';

const emptyState = { public: {}, private: {}, metadata: {} } as any;

describe('debounce timers and destroy()', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('cancels pending @Debounce and @OnWindow({ debounce }) calls on destroy', async () => {
        const calls: string[] = [];
        class Page extends Cossack {
            protected override isServer = false;
            @Debounce(100)
            search(query: string) { calls.push(`search:${query}`); }
            @OnWindow('resize', { debounce: 100 })
            onResize() { calls.push('resize'); }
            render() { return html`<p></p>`; }
        }
        const page = new Page();
        await page.bootstrap({ container: document.createElement('div'), initialState: emptyState });

        page.search('a');
        window.dispatchEvent(new Event('resize'));
        await page.destroy();
        vi.advanceTimersByTime(500);
        expect(calls).toEqual([]);
    });

    it('still runs debounced calls on live components', async () => {
        const calls: string[] = [];
        class Page extends Cossack {
            protected override isServer = false;
            @Debounce(100)
            search(query: string) { calls.push(query); }
            render() { return html`<p></p>`; }
        }
        const page = new Page();
        await page.bootstrap({ container: document.createElement('div'), initialState: emptyState });
        page.search('a');
        page.search('b');
        vi.advanceTimersByTime(150);
        expect(calls).toEqual(['b']);
        await page.destroy();
    });
});
