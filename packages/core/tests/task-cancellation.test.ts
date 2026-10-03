import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { ClientTask, ServerTask, State, Task } from '../src/shared/decorators';

import { TaskCommitError, type TaskContext } from '../src/shared/task';
import { createInstance } from '../src/shared/container';
import { Inject, Service } from '../src/shared/decorators';
import { ServiceScope } from '../src/shared/service-scope';

/**
 * RT-05 acceptance: a slow first execution cannot overwrite the results of a
 * newer execution; dependency changes cancel stale work; disposal cancels
 * everything; failures report the task, component, and trigger.
 */

function flush(times = 6) {
    return new Promise(resolve => setTimeout(resolve, times));
}

describe('task cancellation and staleness (RT-05)', () => {
    it('aborts settled setup signals before rerun cleanup and before component cleanup', async () => {
        const signals: AbortSignal[] = [];
        const cleanups: boolean[] = [];
        let atComponentCleanup = false;
        class Settled extends Cossack {
            @State() value = 0;
            @Task({ track: ['value'] })
            async subscribe(signal: AbortSignal) {
                signals.push(signal);
                await Promise.resolve();
                return () => { cleanups.push(signal.aborted); };
            }
            onCleanup() { atComponentCleanup = signals.every(signal => signal.aborted); }
        }
        const page = new Settled();
        await page.bootstrap({ skipInit: true });
        await vi.waitFor(() => expect(signals).toHaveLength(1));
        await flush();
        page.value = 1;
        await vi.waitFor(() => expect(signals).toHaveLength(2));
        expect(signals[0]!.aborted).toBe(true);
        expect(cleanups).toEqual([true]);
        await page.destroyAsync();
        expect(signals[1]!.aborted).toBe(true);
        expect(atComponentCleanup).toBe(true);
        expect(cleanups).toEqual([true, true]);
    });

    it('keeps synchronous setup signals owned until disposal', async () => {
        let signal!: AbortSignal;
        const cleanup = vi.fn();
        class Sync extends Cossack {
            @Task() subscribe(owned: AbortSignal) { signal = owned; return cleanup; }
        }
        const page = new Sync();
        await page.bootstrap({ skipInit: true });
        expect(signal.aborted).toBe(false);
        await page.destroyAsync();
        expect(signal.aborted).toBe(true);
        expect(cleanup).toHaveBeenCalledOnce();
    });
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
    it('gates uncancellable slow results and rejects commits after disposal', async () => {
        const contexts: TaskContext<Search>[] = [];
        const releases: Array<(value: string) => void> = [];
        const applied: boolean[] = [];
        class Search extends Cossack {
            @State() query = 'first';
            @State() result = '';
            @Task<Search>({ track: ['query'] as const })
            async search(_signal: AbortSignal, task: TaskContext<Search>) {
                contexts.push(task);
                const value = await new Promise<string>(resolve => releases.push(resolve));
                applied.push(task.commit({ result: value }));
            }
        }
        const page = new Search();
        await page.bootstrap({ skipInit: true });
        expect(Object.isFrozen(contexts[0])).toBe(true);
        expect(contexts[0].trigger).toBe('bootstrap');
        page.query = 'second';
        await vi.waitFor(() => expect(releases).toHaveLength(2));
        expect(contexts[0].isCurrent).toBe(false);
        expect(contexts[1].trigger).toContain('query');
        releases[1]('new');
        await vi.waitFor(() => expect(page.result).toBe('new'));
        releases[0]('old');
        await vi.waitFor(() => expect(applied).toEqual([true, false]));
        expect(page.result).toBe('new');
        await page.destroyAsync();
        expect(contexts[1].commit({ result: 'disposed' })).toBe(false);
        expect(contexts[1].isCurrent).toBe(false);
        expect(page.result).toBe('new');
        await (page as any).runTasks();
        expect(releases).toHaveLength(2);
    });

    it('validates a whole commit before changing fields and never invokes value getters', async () => {
        let task!: TaskContext<Fields>;
        const getter = vi.fn(() => 'read');
        class Fields extends Cossack {
            @State() result = 'initial';
            ordinary = 'ordinary';
            @Task() capture(_signal: AbortSignal, context: TaskContext<Fields>) { task = context; }
        }
        const page = new Fields();
        await page.bootstrap({ skipInit: true });
        expect(() => task.commit({ result: 'changed', ordinary: 'wrong' })).toThrow(TaskCommitError);
        expect(page.result).toBe('initial');
        expect(page.ordinary).toBe('ordinary');
        expect(() => task.commit(Object.defineProperty({}, 'result', { get: getter }))).toThrow('data property');
        expect(getter).not.toHaveBeenCalled();
        expect(() => task.commit((() => {}) as any)).toThrow('plain object');
        expect(() => task.commit(Promise.resolve({ result: 'wrong' }) as any)).toThrow('plain object');
        expect(task.commit(Object.assign(Object.create(null), { result: 'valid' }))).toBe(true);
        expect(page.result).toBe('valid');
        await page.destroyAsync();
    });

    it('drains rejected cleanup and siblings with component, trigger and stage diagnostics', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const goodCleanup = vi.fn();
        const runs: number[] = [];
        class CleanupFailure extends Cossack {
            @State() value = 0;
            @Task<CleanupFailure>({ track: ['value'] })
            work() {
                runs.push(this.value);
                return async () => { throw new Error('cleanup failed'); };
            }
            @Task() sibling() { return goodCleanup; }
        }
        try {
            const page = new CleanupFailure();
            await page.bootstrap({ skipInit: true });
            page.value = 1;
            await vi.waitFor(() => expect(runs).toEqual([0, 1]));
            expect(errors.mock.calls.some(([message]) => String(message).includes("'work' on CleanupFailure failed during dependency change (value) (cleanup)"))).toBe(true);
            await page.destroyAsync();
            expect(goodCleanup).toHaveBeenCalledTimes(2);
            expect(errors.mock.calls.some(([message]) => String(message).includes('disposal (cleanup)'))).toBe(true);
        } finally { errors.mockRestore(); }
    });

    it('retains inherited sibling tasks and lets child decorators replace execution kind', async () => {
        const runs: string[] = [];
        const cleanup = vi.fn();
        class Parent extends Cossack {
            @Task() inherited() { runs.push('inherited'); return cleanup; }
            @Task() changed() { runs.push('parent'); }
            @ClientTask() skipped() { runs.push('parent-client'); }
        }
        class Child extends Parent {
            @ClientTask<Child>() override changed() { runs.push('child-client'); }
            @ServerTask<Child>() override skipped() { runs.push('child-server'); }
            @Task<Child>() own() { runs.push('own'); }
        }
        const page = new Child();
        await page.bootstrap({ skipInit: true });
        expect(runs).toEqual(['inherited', 'child-client', 'own']);
        await page.destroyAsync();
        expect(cleanup).toHaveBeenCalledOnce();
    });

    it('aborts component work and awaits cleanup before disposing its owned service scope', async () => {
        const events: string[] = [];
        let task!: TaskContext<Owner>;
        let release!: () => void;
        const cleanup = new Promise<void>(resolve => { release = resolve; });
        @Service()
        class Scoped {
            label = 'owned';
            onDispose() {
                expect(task.isCurrent).toBe(false);
                expect(task.signal.aborted).toBe(true);
                events.push('service');
            }
        }
        class Owner extends Cossack {
            @Inject(Scoped) service!: Scoped;
            @State() result = '';
            @Task<Owner>() work(_signal: AbortSignal, context: TaskContext<Owner>) {
                task = context;
                expect(this.service.label).toBe('owned');
                return async () => {
                    expect(context.commit({ result: 'after disposal' })).toBe(false);
                    events.push('cleanup-start');
                    await cleanup;
                    events.push('cleanup-end');
                };
            }
        }
        const scope = new ServiceScope(undefined, [Scoped]);
        const page = createInstance(Owner, { serviceScope: scope, ownsServiceScope: true });
        await page.bootstrap({ skipInit: true });
        const destroyed = page.destroyAsync();
        expect(events).toEqual(['cleanup-start']);
        release();
        await destroyed;
        expect(events).toEqual(['cleanup-start', 'cleanup-end', 'service']);
        expect(page.result).toBe('');
    });

    it('reports invalid task patches as commit-stage failures', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        class BadPatch extends Cossack {
            ordinary = '';
            @Task() load(_signal: AbortSignal, task: TaskContext<BadPatch>) {
                task.commit({ ordinary: 'invalid' });
            }
        }
        try {
            const page = new BadPatch();
            await page.bootstrap({ skipInit: true });
            expect(errors).toHaveBeenCalledWith(
                "[Cossack] Task 'load' on BadPatch failed during bootstrap (commit):", expect.any(TaskCommitError));
            expect(page.ordinary).toBe('');
            await page.destroyAsync();
        } finally { errors.mockRestore(); }
    });

    it('runs synchronous task setup and cleanup immediately without an async cleanup', async () => {
        const events: string[] = [];
        class SyncOrdering extends Cossack {
            @State() value = 0;
            @Task<SyncOrdering>({ track: ['value'] }) work(signal: AbortSignal) {
                events.push('setup');
                return () => { expect(signal.aborted).toBe(true); events.push('cleanup'); };
            }
        }
        const page = new SyncOrdering();
        await page.bootstrap({ skipInit: true });
        events.length = 0;
        const run = (page as any).runTasks(new Set(['value']));
        expect(events).toEqual(['cleanup', 'setup']);
        await run;
        await page.destroyAsync();
        expect(events).toEqual(['cleanup', 'setup', 'cleanup']);
    });

});
