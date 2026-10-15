// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { State, Task } from '../src/shared/decorators';

/**
 * Client renders run every component's tasks. A task that does not run must
 * not allocate, and a task that does gets its AbortController and context only
 * when it actually starts. Cancellation, abort reasons and errors stay the same.
 */
let constructed = 0;
class CountingAbortController extends AbortController {
    constructor() { super(); constructed++; }
}

/** One client render pass over the component's tasks. */
const render = (page: Cossack, paths?: string[]) =>
    (page as unknown as { runTasks(paths?: Set<string>, trigger?: string): Promise<boolean> })
        .runTasks(paths && new Set(paths), 'render');
const contextSpy = () => vi.spyOn(Cossack.prototype as unknown as { _createTaskContext: () => unknown }, '_createTaskContext');

describe('task allocation across renders', () => {
    beforeEach(() => { vi.stubGlobal('AbortController', CountingAbortController); });
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it('keeps tasks that do not run free of controllers, contexts and path splitting', async () => {
        const runs = vi.fn();
        class Search extends Cossack {
            @State() query = '';
            @State() other = 0;
            @Task({ track: ['query'] }) search() { runs('search'); }
            @Task({ track: ['form.filters.status'] }) filter() { runs('filter'); }
        }
        const page = new Search();
        await page.bootstrap({ skipInit: true });
        expect(runs).toHaveBeenCalledTimes(2);
        constructed = 0;
        const contexts = contextSpy();
        const split = vi.spyOn(String.prototype, 'split');
        let splits: number;
        try {
            for (let index = 0; index < 5; index++) {
                await render(page, ['other']);
                await render(page, ['form.filtersX']);
                await render(page, []);
            }
        } finally {
            splits = split.mock.calls.length;
            split.mockRestore();
        }
        expect(splits).toBe(0);
        expect(constructed).toBe(0);
        expect(contexts).not.toHaveBeenCalled();
        expect(runs).toHaveBeenCalledTimes(2);
        // A matching segment path still restarts exactly the tracking task.
        await render(page, ['form.filters']);
        expect(runs).toHaveBeenLastCalledWith('filter');
        expect(constructed).toBe(1);
        expect(contexts).toHaveBeenCalledOnce();
        await page.destroyAsync();
    });

    it('gives each restarting task one controller and context, aborting the previous one with the default reason', async () => {
        const signals: Record<string, AbortSignal[]> = { first: [], second: [] };
        class Live extends Cossack {
            @Task() first(signal: AbortSignal) { signals.first.push(signal); }
            @Task() second(signal: AbortSignal) { signals.second.push(signal); }
        }
        const page = new Live();
        await page.bootstrap({ skipInit: true });
        constructed = 0;
        const contexts = contextSpy();
        await render(page, []);
        expect(constructed).toBe(2);
        expect(contexts).toHaveBeenCalledTimes(2);
        for (const [previous, next] of [signals.first, signals.second]) {
            expect(previous.aborted).toBe(true);
            // The platform's default reason, created by abort() itself.
            expect(previous.reason).toMatchObject({ name: 'AbortError', message: 'This operation was aborted' });
            expect(next.aborted).toBe(false);
        }
        expect(signals.first[0].reason).not.toBe(signals.second[0].reason);
        await page.destroyAsync();
        expect(signals.first[1].aborted && signals.second[1].aborted).toBe(true);
    });

    it('starts only the latest request after a pending cleanup, without allocating for superseded ones', async () => {
        let release!: () => void;
        const cleanupDone = new Promise<void>(resolve => { release = resolve; });
        const started: { signal: AbortSignal; trigger: string }[] = [];
        class Slow extends Cossack {
            @Task() work(signal: AbortSignal, context: { trigger: string }) {
                started.push({ signal, trigger: context.trigger });
                return () => cleanupDone;
            }
        }
        const page = new Slow();
        await page.bootstrap({ skipInit: true });
        constructed = 0;
        const contexts = contextSpy();
        for (let index = 0; index < 5; index++) await render(page, ['step']);
        expect(started).toHaveLength(1);
        expect(started[0].signal.aborted).toBe(true);
        expect(constructed).toBe(0);
        expect(contexts).not.toHaveBeenCalled();
        release();
        await vi.waitFor(() => expect(started).toHaveLength(2));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(started).toHaveLength(2);
        expect(started[1]).toMatchObject({ trigger: 'dependency change (step)' });
        expect(started[1].signal.aborted).toBe(false);
        expect(constructed).toBe(1);
        expect(contexts).toHaveBeenCalledOnce();
        await page.destroyAsync();
        expect(started[1].signal.aborted).toBe(true);
    });

    it('does not start later tasks of a run after an earlier task destroys the component', async () => {
        const second = vi.fn();
        class Fragile extends Cossack {
            armed = false;
            @Task() first() { if (this.armed) this.destroy(); }
            @Task() check() { second(); }
        }
        const page = new Fragile();
        await page.bootstrap({ skipInit: true });
        expect(second).toHaveBeenCalledOnce();
        page.armed = true;
        constructed = 0;
        await render(page, []);
        expect(second).toHaveBeenCalledOnce();
        expect(constructed).toBe(1);
    });

    it('reports a failing restarted task once with its trigger', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        let fail = false;
        class Failing extends Cossack {
            @Task() load() { if (fail) throw new Error('boom'); }
        }
        const page = new Failing();
        await page.bootstrap({ skipInit: true });
        fail = true;
        await render(page, ['query']);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(error).toHaveBeenCalledOnce();
        expect(String(error.mock.calls[0][0])).toContain("Task 'load' on Failing failed during dependency change (query) (setup)");
        await page.destroyAsync();
    });
});
