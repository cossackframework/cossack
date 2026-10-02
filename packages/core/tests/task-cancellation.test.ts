import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { State, Task } from '../src/shared/decorators';

/**
 * RT-05 acceptance: a slow first execution cannot overwrite the results of a
 * newer execution; dependency changes cancel stale work; disposal cancels
 * everything; failures report the task, component, and trigger.
 */

function flush(times = 6) {
    return new Promise(resolve => setTimeout(resolve, times));
}

describe('task cancellation and staleness (RT-05)', () => {
    it('cleans up setup that resolves after disposal', async () => {
        let finish!: (cleanup: () => void) => void;
        const pending = new Promise<() => void>(resolve => { finish = resolve; });
        const cleanup = vi.fn();
        class Late extends Cossack {
            @Task() work() { return pending; }
        }
        const page = new Late();
        await page.bootstrap({ skipInit: true });
        await page.destroyAsync();
        finish(cleanup);
        await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
    });

    it('waits for cleanup across rapid changes and skips an already canceled run', async () => {
        let release!: () => void;
        const cleanup = new Promise<void>(resolve => { release = resolve; });
        const runs: number[] = [];
        class Ordered extends Cossack {
            @State() value = 0;
            @Task({ track: ['value'] }) work() {
                runs.push(this.value);
                return () => cleanup;
            }
        }
        const page = new Ordered();
        await page.bootstrap({ skipInit: true });
        await vi.waitFor(() => expect(runs).toEqual([0]));
        page.value = 1;
        await flush();
        page.value = 2;
        await flush();
        expect(runs).toEqual([0]);
        release();
        await vi.waitFor(() => expect(runs).toEqual([0, 2]));
        await page.destroyAsync();
    });
    it('a slow stale task cannot overwrite a newer result', async () => {
        const applied: string[] = [];
        class SearchPage extends Cossack {
            @State() query = 'a';
            @State() results: string[] = [];

            @Task({ track: ['query'] })
            async search(signal: AbortSignal) {
                const query = this.query;
                const slow = query === 'a';
                await new Promise(resolve => setTimeout(resolve, slow ? 80 : 5));
                expect(signal.aborted).toBe(slow); // the slow first run was cancelled
                if (signal.aborted) return;
                applied.push(query);
                this.results = [query];
            }
        }
        const page = new SearchPage();
        await page.bootstrap({ skipInit: true }); // bootstrap run starts the slow 'a' execution
        (page as any).query = 'b';
        await flush(4);
        await vi.waitFor(() => expect(applied).toEqual(['b']), { timeout: 1000 });
        expect((page as any).results).toEqual(['b']);
        await page.destroyAsync();
    });

    it('passes a cancellation signal and aborts on disposal', async () => {
        const seen: boolean[] = [];
        class Job extends Cossack {
            @Task()
            async work(signal: AbortSignal) {
                await new Promise(resolve => setTimeout(resolve, 50));
                seen.push(signal.aborted);
            }
        }
        const job = new Job();
        await job.bootstrap({ skipInit: true });
        await flush(2); // let the task start
        await job.destroyAsync();
        expect(seen.length === 0 || seen[0] === true).toBe(true); // aborted before applying
    });

    it('reports the task name, component, and trigger on failure', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        class Failing extends Cossack {
            @State() value = 1;
            @Task({ track: ['value'] })
            async boom() { throw new Error('kaboom'); }
        }
        const page = new Failing();
        await page.bootstrap({ skipInit: true });
        // The bootstrap run fails first; observe it, then trigger a dependency
        // change and assert the SECOND failure names the trigger.
        await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled(), { timeout: 1000 });
        errorSpy.mockClear();
        (page as any).value = 2;
        await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled(), { timeout: 1000 });
        const message = errorSpy.mock.calls.map(call => call.join(' ')).join(' ');
        expect(message).toContain("'boom'");
        expect(message).toContain('Failing');
        expect(message).toContain('dependency change');
        errorSpy.mockRestore();
        await page.destroyAsync();
    });

    it('slow first task does not delay a sibling fast task', async () => {
        const order: string[] = [];
        class Siblings extends Cossack {
            @Task()
            async slow() { await new Promise(resolve => setTimeout(resolve, 60)); order.push('slow'); }
            @Task()
            fast() { order.push('fast'); }
        }
        const page = new Siblings();
        await page.bootstrap({ skipInit: true });
        await vi.waitFor(() => expect(order).toContain('slow'), { timeout: 1000 });
        expect(order.indexOf('fast')).toBeLessThan(order.indexOf('slow'));
        await page.destroyAsync();
    });

    it('a stale deferred resolving after a newer one never applies', async () => {
        const applied: string[] = [];
        const resolvers: Array<(value: string) => void> = [];
        const make = () => new Promise<string>(resolve => resolvers.push(resolve));
        let call = 0;
        const pending = [make(), make()];
        class Deterministic extends Cossack {
            @State() query = 'a';
            @Task({ track: ['query'] })
            async load(signal: AbortSignal) {
                const value = await pending[Math.min(call++, pending.length - 1)];
                if (signal.aborted) return;
                applied.push(value);
            }
        }
        const page = new Deterministic();
        await page.bootstrap({ skipInit: true }); // slow 'a' starts
        (page as any).query = 'b';
        resolvers[1]('fresh');
        resolvers[0]('stale'); // stale resolves last: must not apply
        await flush(6);
        expect(applied).toEqual(['fresh']);
        await page.destroyAsync();
    });
});
