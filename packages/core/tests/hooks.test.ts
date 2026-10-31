import { describe, expect, it } from 'vitest';
import { createHookRegistry, defineAction, defineFilter, HookError } from '../src/hooks/index';

interface Draft { title: string; tags: string[] }
const beforeWrite = defineFilter<Draft, { resource: string; user: { id: string } }>('cms.resource.before-write', { timeoutMs: 50 });
const afterCommit = defineAction<{ id: string }>('cms.resource.after-commit', { timeoutMs: 50 });

describe('hook registry', () => {
    it('orders by priority, then plugin name, then registration', async () => {
        const hooks = createHookRegistry();
        const order: string[] = [];
        const add = (plugin: string, priority?: number) => hooks.addAction(afterCommit, () => { order.push(`${plugin}:${priority ?? 10}`); }, { plugin, ...(priority === undefined ? {} : { priority }) });
        add('zeta'); add('alpha'); add('beta', 1); add('alpha', 20); add('alpha');
        await hooks.doAction(afterCommit, { id: 'p1' });
        expect(order).toEqual(['beta:1', 'alpha:10', 'alpha:10', 'zeta:10', 'alpha:20']);
        expect(hooks.handlers(afterCommit).map(handler => handler.plugin)).toEqual(['beta', 'alpha', 'alpha', 'zeta', 'alpha']);
    });

    it('threads filter values and stops at the first error', async () => {
        const hooks = createHookRegistry();
        hooks.addFilter(beforeWrite, (draft, context) => ({ ...draft, title: `${draft.title} by ${context.input.user.id}` }), { plugin: 'a' });
        hooks.addFilter(beforeWrite, draft => ({ ...draft, tags: [...draft.tags, 'x'] }), { plugin: 'b' });
        expect(await hooks.applyFilters(beforeWrite, { title: 'Hi', tags: [] }, { resource: 'posts', user: { id: 'u1' } })).toEqual({ title: 'Hi by u1', tags: ['x'] });
        let ran = false;
        hooks.addFilter(beforeWrite, () => { throw new Error('invalid title'); }, { plugin: 'c' });
        hooks.addFilter(beforeWrite, draft => { ran = true; return draft; }, { plugin: 'd' });
        const error = await hooks.applyFilters(beforeWrite, { title: 'Hi', tags: [] }, { resource: 'posts', user: { id: 'u1' } }).catch(e => e) as HookError;
        expect(error).toBeInstanceOf(HookError);
        expect(error).toMatchObject({ code: 'COSSACK_HOOK_FAILED', plugin: 'c', point: 'cms.resource.before-write' });
        expect((error.cause as Error).message).toBe('invalid title');
        expect(ran).toBe(false);
    });

    it('runs every action and reports each failure for retry', async () => {
        const hooks = createHookRegistry();
        const calls: string[] = [];
        hooks.addAction(afterCommit, () => { calls.push('a'); throw new Error('webhook down'); }, { plugin: 'a' });
        hooks.addAction(afterCommit, () => { calls.push('b'); }, { plugin: 'b' });
        hooks.addAction(afterCommit, () => new Promise(() => {}), { plugin: 'c' });
        const report = await hooks.doAction(afterCommit, { id: 'p1' });
        expect(calls).toEqual(['a', 'b']);
        expect(report.ok).toBe(false);
        expect(report.outcomes.map(outcome => outcome.status)).toEqual(['failed', 'ok', 'timeout']);
        expect(report.failed).toEqual(['a', 'c']);
        calls.length = 0;
        await hooks.doAction(afterCommit, { id: 'p1' }, { only: ['a'] });
        expect(calls).toEqual(['a']);
    });

    it('enforces deadlines and aborts the handler signal', async () => {
        const hooks = createHookRegistry();
        let aborted: unknown;
        hooks.addFilter(beforeWrite, (draft, context) => new Promise(resolve => {
            context.signal.addEventListener('abort', () => { aborted = context.signal.reason; resolve(draft); });
        }), { plugin: 'slow' });
        const error = await hooks.applyFilters(beforeWrite, { title: 'x', tags: [] }, { resource: 'posts', user: { id: 'u' } }, { timeoutMs: 10 }).catch(e => e);
        expect(error).toMatchObject({ code: 'COSSACK_HOOK_TIMEOUT', plugin: 'slow' });
        expect(aborted).toBeInstanceOf(HookError);
    });

    it('propagates caller cancellation', async () => {
        const hooks = createHookRegistry();
        const controller = new AbortController();
        const seen: string[] = [];
        hooks.addAction(afterCommit, async (_, context) => {
            seen.push('first');
            controller.abort(new Error('client went away'));
            expect(context.signal.aborted).toBe(true);
        }, { plugin: 'a' });
        hooks.addAction(afterCommit, () => { seen.push('second'); }, { plugin: 'b' });
        const report = await hooks.doAction(afterCommit, { id: 'p1' }, { signal: controller.signal });
        expect(seen).toEqual(['first']);
        // Cancellation while a handler runs wins the race; its late result is ignored.
        expect(report.outcomes.map(outcome => outcome.status)).toEqual(['cancelled', 'cancelled']);
        await expect(hooks.applyFilters(beforeWrite, { title: 'x', tags: [] }, { resource: 'r', user: { id: 'u' } }, { signal: controller.signal }))
            .resolves.toEqual({ title: 'x', tags: [] });
        hooks.addFilter(beforeWrite, draft => draft, { plugin: 'f' });
        await expect(hooks.applyFilters(beforeWrite, { title: 'x', tags: [] }, { resource: 'r', user: { id: 'u' } }, { signal: controller.signal }))
            .rejects.toMatchObject({ code: 'COSSACK_HOOK_CANCELLED' });
    });

    it('isolates handlers with frozen copies and fresh contexts', async () => {
        const hooks = createHookRegistry();
        const contexts: object[] = [];
        const payload = { id: 'p1', nested: { count: 1 } } as { id: string; nested?: { count: number } };
        hooks.addAction(afterCommit, (event, context) => {
            contexts.push(context);
            (event as { id: string }).id = 'changed';
        }, { plugin: 'mutator' });
        hooks.addAction(afterCommit, (event, context) => {
            contexts.push(context);
            expect(event.id).toBe('p1');
            expect(Object.isFrozen(context)).toBe(true);
        }, { plugin: 'reader' });
        const report = await hooks.doAction(afterCommit, payload);
        expect(report.outcomes[0]).toMatchObject({ status: 'failed', plugin: 'mutator' });
        expect(report.outcomes[1]).toMatchObject({ status: 'ok' });
        expect(contexts[0]).not.toBe(contexts[1]);
        expect(Object.isFrozen(payload)).toBe(false);
        payload.nested!.count = 2;

        const filters = createHookRegistry();
        filters.addFilter(beforeWrite, draft => { draft.tags.push('leak'); return draft; }, { plugin: 'pusher' });
        const draft = { title: 't', tags: [] as string[] };
        await expect(filters.applyFilters(beforeWrite, draft, { resource: 'r', user: { id: 'u' } })).rejects.toMatchObject({ code: 'COSSACK_HOOK_FAILED' });
        expect(draft.tags).toEqual([]);
    });

    it('rejects undefined filter results, incompatible versions and late registration', async () => {
        const hooks = createHookRegistry();
        hooks.addFilter(beforeWrite, (() => undefined) as never, { plugin: 'broken' });
        await expect(hooks.applyFilters(beforeWrite, { title: 't', tags: [] }, { resource: 'r', user: { id: 'u' } })).rejects.toMatchObject({ code: 'COSSACK_HOOK_FAILED', plugin: 'broken' });
        expect(() => hooks.addFilter(beforeWrite, draft => draft, { plugin: 'old', version: 2 })).toThrow(HookError);
        const v2 = defineFilter<Draft, { resource: string; user: { id: string } }>('cms.resource.before-write', { version: 2 });
        expect(() => hooks.addFilter(v2, draft => draft, { plugin: 'new' })).toThrow(HookError);
        await expect(hooks.applyFilters(v2, { title: 't', tags: [] }, { resource: 'r', user: { id: 'u' } })).rejects.toMatchObject({ code: 'COSSACK_HOOK_INVALID' });
        expect(() => hooks.addAction(beforeWrite as never, () => {}, { plugin: 'x' })).toThrow(TypeError);
        expect(() => hooks.addAction(afterCommit, () => {}, { plugin: 'Bad Name' })).toThrow(TypeError);
        hooks.freeze();
        expect(() => hooks.addAction(afterCommit, () => {}, { plugin: 'late' })).toThrow(/frozen/);
        expect(() => defineAction('Bad Name')).toThrow(TypeError);
    });
});
