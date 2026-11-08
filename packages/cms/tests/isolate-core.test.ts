import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it } from 'vitest';
import { defineAction, defineFilter } from '@cossackframework/core/hooks';
import { createIsolateRuntime, type CurrentCall } from '../src/isolate-core';
import { ISOLATE_PROTOCOL, type IsolateBridge, type IsolateCall, type IsolateRun } from '../src/isolation';
import type { CmsPluginManifest } from '../src/manifest';
import { systemPrincipal } from '../src/permissions';
import type { PluginContext } from '../src/server/host';

const saved = defineAction<{ id: string }>('cms.resource.after-commit', { version: 1, timeoutMs: 10_000 });
const draft = defineFilter<{ title: string }, { resource: string }>('cms.resource.before-write', { version: 1, timeoutMs: 2_000 });
const manifest = {
    name: 'desk', version: '1.0.0',
    hooks: [{ point: 'cms.resource.after-commit', version: 1 }, { point: 'cms.resource.before-write', version: 1 }],
    provides: [{ point: 'desk.ticket-closed', kind: 'action', version: 1 }],
    commands: [{ name: 'close-all', description: 'Close every ticket.' }],
} as unknown as CmsPluginManifest;
const points = [
    { name: 'cms.resource.after-commit', kind: 'action', version: 1, timeoutMs: 10_000 },
    { name: 'cms.resource.before-write', kind: 'filter', version: 1, timeoutMs: 2_000 },
    { name: 'desk.ticket-closed', kind: 'action', version: 1, timeoutMs: 5_000 },
] as const;

/** A bridge that records what it is asked and answers from `answers`. */
function bridge(site: string, answers: Record<string, (...args: unknown[]) => unknown> = {}) {
    const calls: [string, unknown[]][] = [];
    const value: IsolateBridge = {
        async call(member, args) {
            calls.push([member, [...args]]);
            const answer = answers[member];
            return answer ? answer(...args) : { site, member };
        },
    };
    return { value, calls };
}

const call = (site: string, run: IsolateRun, extra: Partial<IsolateCall> = {}): IsolateCall => ({
    protocol: ISOLATE_PROTOCOL, site, deadline: Date.now() + 5_000, resources: ['desk/tickets'], points, payments: 'stripe', run, ...extra,
});

function runtime(register: (context: PluginContext) => unknown) {
    let registrations = 0;
    const isolate = createIsolateRuntime({ register: (context: PluginContext) => { registrations++; return register(context); } }, manifest, new AsyncLocalStorage<CurrentCall>());
    return { isolate, registrations: () => registrations };
}

describe('isolate runtime', () => {
    it('registers once per site, under that site\'s call', async () => {
        const { isolate, registrations } = runtime(async context => {
            const greeting = await context.settings.get('greeting');
            context.hooks.addFilter(draft, value => ({ title: `${String(greeting)} ${value.title}` }));
        });
        const one = bridge('one', { 'settings.get': () => 'Hello' });
        const two = bridge('two', { 'settings.get': () => 'Hi' });
        const filter = { kind: 'filter', point: 'cms.resource.before-write', value: { title: 'desk' }, input: { resource: 'desk/tickets' } } as const;
        expect(await isolate.run(call('one', filter), one.value)).toEqual({ title: 'Hello desk' });
        expect(await isolate.run(call('two', filter), two.value)).toEqual({ title: 'Hi desk' });
        expect(await isolate.run(call('one', filter), one.value)).toEqual({ title: 'Hello desk' });
        expect(registrations()).toBe(2);
        expect(one.calls).toEqual([['settings.get', ['greeting']]]);
    });

    it('runs actions in priority order and returns a failed handler\'s own error after the rest', async () => {
        const ran: string[] = [];
        const { isolate } = runtime(context => {
            context.hooks.addAction(saved, () => { ran.push('late'); }, { priority: 20 });
            context.hooks.addAction(saved, () => { ran.push('failing'); throw Object.assign(new Error('nope'), { code: 'CMS_CONFLICT' }); });
            context.hooks.addAction(saved, () => { ran.push('early'); }, { priority: 1 });
        });
        const error = await isolate.run(call('main', { kind: 'action', point: 'cms.resource.after-commit', payload: { id: 'r1' } }), bridge('main').value).catch((caught: unknown) => caught);
        expect(ran).toEqual(['early', 'failing', 'late']);
        expect(error).toMatchObject({ message: 'nope', code: 'CMS_CONFLICT' });
    });

    it('stops filters at the first error', async () => {
        const { isolate } = runtime(context => {
            context.hooks.addFilter(draft, () => { throw Object.assign(new Error('Title taken.'), { code: 'CMS_VALIDATION' }); });
            context.hooks.addFilter(draft, () => ({ title: 'never' }), { priority: 50 });
        });
        await expect(isolate.run(call('main', { kind: 'filter', point: 'cms.resource.before-write', value: { title: 'x' }, input: {} }), bridge('main').value))
            .rejects.toMatchObject({ code: 'CMS_VALIDATION', message: 'Title taken.' });
    });

    it('runs commands and jobs with the principal the host gave', async () => {
        const seen: unknown[] = [];
        const { isolate } = runtime(context => {
            context.commands.add('close-all', async (input, { principal, signal }) => { seen.push(['command', input, principal, signal instanceof AbortSignal]); return { closed: 2 }; });
            context.jobs.handle('notify', async (payload, { principal, scheduledAt }) => { seen.push(['job', payload, principal, scheduledAt]); });
        });
        const user = { kind: 'user', id: 'u1', roles: ['administrator'], permissions: [] } as const;
        expect(await isolate.run(call('main', { kind: 'command', name: 'close-all', input: { force: true }, principal: user }), bridge('main').value)).toEqual({ closed: 2 });
        expect(await isolate.run(call('main', { kind: 'job', name: 'notify', payload: { ticket: 't1' }, scheduledAt: 123, principal: systemPrincipal('plugin:desk') }), bridge('main').value)).toBeNull();
        expect(seen).toEqual([['command', { force: true }, user, true], ['job', { ticket: 't1' }, { kind: 'system', reason: 'plugin:desk' }, 123]]);
        await expect(isolate.run(call('main', { kind: 'command', name: 'missing', input: {}, principal: user }), bridge('main').value)).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        await expect(isolate.run(call('main', { kind: 'job', name: 'missing', payload: null, scheduledAt: null, principal: user }), bridge('main').value)).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
    });

    it('forwards context members to the bridge and keeps local what cannot cross', async () => {
        let context!: PluginContext;
        const { isolate } = runtime(given => {
            context = given;
            given.jobs.handle('notify', () => undefined);
            given.commands.add('close-all', async () => {
                const tickets = given.cms.resource('desk/tickets');
                const controller = new AbortController();
                await tickets.list({ limit: 5 } as never, { principal: systemPrincipal('plugin:desk'), signal: controller.signal } as never);
                await given.jobs.enqueue('notify', { ticket: 't1' }, { delayMs: 10 });
                await expect(given.jobs.enqueue('unknown')).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
                await given.cache.remember('count', 1_000, async () => 42);
                await given.hooks.doAction(given.hooks.point('desk.ticket-closed', 'action'), { id: 't1' });
                await expect(given.unrestricted()).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
                return { url: given.files.url({ id: 'f1', name: 'a b.png' }), provider: given.payments.provider, response: await (await given.fetch('https://api.example.com/x', { method: 'POST', body: 'hi' }) as Response).text() };
            });
        });
        const { value, calls } = bridge('main', {
            'cache.get': () => undefined,
            fetch: async (request: unknown) => new Response(`${(request as Request).method} ${(request as Request).url} ${await (request as Request).text()}`),
        });
        const result = await isolate.run(call('main', { kind: 'command', name: 'close-all', input: {}, principal: { kind: 'anonymous' } }), value);
        expect(result).toEqual({ url: '/media/f1/a%20b.png', provider: 'stripe', response: 'POST https://api.example.com/x hi' });
        expect(calls.map(([member]) => member)).toEqual(['resource.list', 'jobs.enqueue', 'cache.get', 'cache.set', 'hooks.doAction', 'fetch']);
        expect(calls[0]).toEqual(['resource.list', ['desk/tickets', { limit: 5 }, { principal: { kind: 'system', reason: 'plugin:desk' } }]]);
        expect(calls[3]).toEqual(['cache.set', ['count', 42, 1_000]]);
        expect(calls[4]).toEqual(['hooks.doAction', ['desk.ticket-closed', { id: 't1' }, undefined]]);
        expect(() => context.settings.get('x')).toThrow('outside a call from the host');
    });

    it('keeps concurrent calls on their own bridges', async () => {
        const { isolate } = runtime(context => {
            context.commands.add('close-all', async input => {
                await new Promise(resolve => setTimeout(resolve, Number(input.wait)));
                return context.settings.get('site');
            });
        });
        const results = await Promise.all(['a', 'b', 'c'].map((site, index) =>
            isolate.run(call('main', { kind: 'command', name: 'close-all', input: { wait: 30 - index * 10 }, principal: { kind: 'anonymous' } }), bridge(site, { 'settings.get': () => site }).value)));
        expect(results).toEqual(['a', 'b', 'c']);
    });

    it('refuses undeclared hooks and commands, and a call from another protocol', async () => {
        const other = defineAction('cms.form.submitted', { version: 1 });
        const { isolate } = runtime(context => { context.hooks.addAction(other, () => undefined); });
        await expect(isolate.run(call('main', { kind: 'action', point: 'cms.resource.after-commit', payload: {} }), bridge('main').value)).rejects.toThrow('does not declare in hooks');
        await expect(isolate.run({ ...call('main', { kind: 'action', point: 'x', payload: {} }), protocol: 99 as never }, bridge('main').value)).rejects.toThrow('Rebuild the application');
        const commands = runtime(context => { context.commands.add('undeclared', () => null); });
        await expect(commands.isolate.run(call('main', { kind: 'command', name: 'undeclared', input: {}, principal: { kind: 'anonymous' } }), bridge('main').value)).rejects.toThrow('which its manifest does not declare');
    });

    it('aborts a handler\'s signal at the deadline', async () => {
        const { isolate } = runtime(context => {
            context.commands.add('close-all', (_input, { signal }) => new Promise(resolve => signal!.addEventListener('abort', () => resolve((signal!.reason as { code?: string }).code))));
        });
        expect(await isolate.run(call('main', { kind: 'command', name: 'close-all', input: {}, principal: { kind: 'anonymous' } }, { deadline: Date.now() + 20 }), bridge('main').value)).toBe('COSSACK_HOOK_TIMEOUT');
    });
});
