import { Miniflare } from 'miniflare';
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The platform behaviour isolated plugins rely on (specs/cms-plugin-isolation.md), checked in
 * workerd through Miniflare: a stub passed with a call, an isolate with no bindings and no
 * network, AsyncLocalStorage per call, loading once per ID, limits, tails and errors. When
 * COSSACK_WORKER_LOADER_REPORT names a file, the measured timings are written there.
 */

const PLUGIN = String.raw`
import { WorkerEntrypoint, env as importedEnv } from 'cloudflare:workers';
import { AsyncLocalStorage } from 'node:async_hooks';
const als = new AsyncLocalStorage();
let kept;
export default class Plugin extends WorkerEntrypoint {
    async ping(bridge) { return bridge.ping('plugin'); }
    async concurrent(bridge, label, delay) {
        return als.run({ bridge, label }, async () => {
            await scheduler.wait(delay);
            const store = als.getStore();
            return { label: store.label, seen: await store.bridge.ping(store.label) };
        });
    }
    async keep(bridge) { kept = typeof bridge.dup === 'function' ? bridge.dup() : bridge; return 'kept'; }
    async useKept() { try { return { ok: await kept.ping('kept') }; } catch (error) { return { error: String(error) }; } }
    async calls(bridge, count) {
        let done = 0;
        try { for (let i = 0; i < count; i++) { await bridge.ping(i); done++; } return { done }; }
        catch (error) { return { done, error: String(error) }; }
    }
    async fetches(count) {
        let done = 0;
        try { for (let i = 0; i < count; i++) { await fetch('https://example.com/' + i).catch(() => {}); done++; } return { done }; }
        catch (error) { return { done, error: String(error) }; }
    }
    async outbound() {
        const result = {};
        try { await fetch('https://example.com/'); result.fetch = 'reached'; } catch (error) { result.fetch = String(error); }
        try { const { connect } = await import('cloudflare:sockets'); const socket = connect('example.com:80'); await socket.opened; result.connect = 'reached'; } catch (error) { result.connect = String(error); }
        return result;
    }
    async ambient() {
        return {
            env: Object.keys(this.env ?? {}),
            imported: Object.keys(importedEnv ?? {}),
            process: typeof process === 'undefined' ? null : Object.keys(process.env ?? {}),
        };
    }
    async spin(iterations) { let x = 0; for (let i = 0; i < iterations; i++) x = (x + i * 7) % 1000003; return x; }
    async fail() { const error = new Error('refused here'); error.code = 'CMS_FORBIDDEN'; throw error; }
    async log() { console.log('hello from plugin'); return true; }
    async sleep(ms) { await scheduler.wait(ms); return ms; }
    async late(bridge, ms) { await scheduler.wait(ms); try { return { ok: await bridge.ping('late') }; } catch (error) { return { error: String(error) }; } }
}
`;

const LOADER = String.raw`
import { WorkerEntrypoint } from 'cloudflare:workers';
const PLUGIN = ${JSON.stringify(PLUGIN)};
const tails = [];
const loads = {};
export class Bridge extends WorkerEntrypoint {
    async ping(from) {
        if (Date.now() > this.ctx.props.deadline) throw new Error('This call has ended.');
        return { site: this.ctx.props.site, from };
    }
}
export class Tail extends WorkerEntrypoint {
    tail(events) { for (const event of events) tails.push({ plugin: this.ctx.props.plugin, logs: (event.logs ?? []).map(log => log.message), outcome: event.outcome }); }
}
function load(env, ctx, id) {
    return env.LOADER.get(id, async () => {
        loads[id] = (loads[id] ?? 0) + 1;
        return {
            compatibilityDate: '2026-06-06', compatibilityFlags: ['nodejs_als'],
            mainModule: 'plugin.js', modules: { 'plugin.js': PLUGIN }, env: {}, globalOutbound: null,
            tails: [ctx.exports.Tail({ props: { plugin: id } })],
        };
    });
}
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const q = name => url.searchParams.get(name);
        const id = q('id') ?? 'probe@1';
        const limits = q('limits') ? JSON.parse(q('limits')) : undefined;
        if (url.pathname === '/loads') return Response.json(loads);
        if (url.pathname === '/tails') return Response.json(tails);
        const plugin = load(env, ctx, id).getEntrypoint(undefined, limits ? { limits } : undefined);
        const bridge = (site, ms = 5_000) => ctx.exports.Bridge({ props: { site, deadline: Date.now() + ms } });
        const timed = async run => { const start = performance.now(); const value = await run(); return { value, ms: performance.now() - start }; };
        const respond = async run => { try { return Response.json(await run()); } catch (error) { return Response.json({ thrown: String(error), name: error?.name, code: error?.code ?? null, message: error?.message }); } };
        switch (url.pathname) {
            case '/ping': return respond(() => timed(() => plugin.ping(bridge(q('site') ?? 'main'))));
            case '/concurrent': return respond(() => Promise.all([
                plugin.concurrent(bridge('a'), 'a', 30), plugin.concurrent(bridge('b'), 'b', 5), plugin.concurrent(bridge('c'), 'c', 15),
            ]));
            case '/keep': return respond(() => plugin.keep(bridge('main', Number(q('ms') ?? 5_000))));
            case '/use-kept': return respond(() => plugin.useKept());
            case '/keep-then-use': return respond(async () => {
                await plugin.keep(bridge('main', 60_000));
                return plugin.useKept();
            });
            case '/late': return respond(() => plugin.late(bridge('main', 5), 30));
            case '/calls': return respond(() => plugin.calls(bridge('main'), Number(q('count'))));
            case '/fetches': return respond(() => plugin.fetches(Number(q('count'))));
            case '/outbound': return respond(() => plugin.outbound());
            case '/ambient': return respond(() => plugin.ambient());
            case '/spin': return respond(() => timed(() => plugin.spin(Number(q('iterations')))));
            case '/fail': return respond(() => plugin.fail());
            case '/log': return respond(() => plugin.log());
            case '/fan-out': return respond(() => Promise.all(Array.from({ length: Number(q('count')) }, (_, i) =>
                load(env, ctx, 'fan@' + i).getEntrypoint().sleep(50).then(value => ({ value }), error => ({ error: String(error) })))));
        }
        return new Response('not found', { status: 404 });
    },
};
`;

describe('Worker Loader, as isolated plugins use it', () => {
    let mf: Miniflare;
    const report: Record<string, unknown> = {};
    const get = async <T = Record<string, unknown>>(path: string): Promise<T> => (await (await mf.dispatchFetch(`http://loader${path}`)).json()) as T;

    beforeAll(async () => {
        mf = new Miniflare({
            modules: true,
            script: LOADER,
            compatibilityDate: '2026-06-06',
            compatibilityFlags: ['nodejs_als'],
            workerLoaders: { LOADER: {} },
        });
        await mf.ready;
    }, 30_000);

    afterAll(async () => {
        await mf?.dispose();
        const file = process.env.COSSACK_WORKER_LOADER_REPORT;
        if (file) writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    });

    it('passes a stub with the call, and props stay with the host', async () => {
        const cold = await get<{ value: unknown; ms: number }>('/ping?id=timing@1&site=one');
        expect(cold.value).toEqual({ site: 'one', from: 'plugin' });
        const warm: number[] = [];
        for (let i = 0; i < 20; i++) warm.push((await get<{ ms: number }>('/ping?id=timing@1&site=two')).ms);
        warm.sort((a, b) => a - b);
        report.coldCallMs = cold.ms;
        report.warmCallMedianMs = warm[10];
        report.warmCallMaxMs = warm.at(-1);
    });

    it('loads once per ID, so sites can share one isolate', async () => {
        for (const site of ['one', 'two', 'three']) expect((await get<{ value: { site: string } }>(`/ping?id=shared@1&site=${site}`)).value.site).toBe(site);
        expect((await get<Record<string, number>>('/loads'))['shared@1']).toBe(1);
    });

    it('keeps each call\'s bridge apart through AsyncLocalStorage', async () => {
        const results = await get<{ label: string; seen: { site: string; from: string } }[]>('/concurrent');
        expect(results.map(result => [result.label, result.seen.site, result.seen.from])).toEqual([['a', 'a', 'a'], ['b', 'b', 'b'], ['c', 'c', 'c']]);
    });

    it('gives the plugin no bindings, no ambient env and no network', async () => {
        const ambient = await get<{ env: string[]; imported: string[]; process: string[] | null }>('/ambient');
        expect(ambient.env).toEqual([]);
        expect(ambient.imported).toEqual([]);
        expect(ambient.process ?? []).toEqual([]);
        const outbound = await get<{ fetch: string; connect: string }>('/outbound');
        report.outbound = outbound;
        expect(outbound.fetch).not.toBe('reached');
        expect(outbound.connect).not.toBe('reached');
    });

    it('scopes a stub to its call, and the deadline ends a call the host gave up on', async () => {
        expect(await get('/keep?ms=60000&id=keep@1')).toBe('kept');
        const later = await get<{ ok?: unknown; error?: string }>('/use-kept?id=keep@1');
        report.keptStubInLaterRequest = later;
        expect(later.ok).toBeUndefined();
        expect(later.error).toContain('different request');
        const next = await get<{ ok?: unknown; error?: string }>('/keep-then-use?id=keep@2');
        report.keptStubInNextCallOfSameRequest = next;
        expect(next.error).toContain('different request');
        const late = await get<{ ok?: unknown; error?: string }>('/late?id=keep@3');
        report.callPastDeadline = late;
        expect(late.error).toContain('This call has ended.');
    });

    it('carries an error\'s message and code across', async () => {
        const failed = await get<{ thrown: string; code: string | null; message: string }>('/fail');
        report.error = failed;
        expect(failed).toMatchObject({ message: 'refused here', code: 'CMS_FORBIDDEN' });
    });

    // Miniflare 4.20260722 enforces none of these: CPU and subrequest limits and the four
    // Dynamic Workers in flight per request hold on Cloudflare only. Recorded, not asserted.
    it('records whether limits hold locally', async () => {
        report.bridgeCallsUnderSubrequestLimit2 = await get(`/calls?count=5&id=sub@1&limits=${encodeURIComponent(JSON.stringify({ subRequests: 2 }))}`);
        report.fetchesUnderSubrequestLimit2 = await get(`/fetches?count=5&id=sub@1&limits=${encodeURIComponent(JSON.stringify({ subRequests: 2 }))}`);
        report.spinUnderCpuLimit10ms = await get(`/spin?iterations=300000000&id=cpu@1&limits=${encodeURIComponent(JSON.stringify({ cpuMs: 10 }))}`);
        report.spinWithoutLimit = await get('/spin?iterations=3000000&id=cpu@1');
        report.fanOut5 = await get('/fan-out?count=5');
        expect(report.spinWithoutLimit).toHaveProperty('value');
    }, 60_000);

    it('sends the plugin\'s logs to the tail', async () => {
        expect(await get('/log?id=tail@1')).toBe(true);
        let tails: { plugin: string; logs: unknown[] }[] = [];
        for (let i = 0; i < 50 && !tails.some(tail => tail.plugin === 'tail@1'); i++) {
            await new Promise(resolve => setTimeout(resolve, 50));
            tails = await get('/tails');
        }
        report.tail = tails.find(tail => tail.plugin === 'tail@1') ?? null;
        expect(JSON.stringify(report.tail)).toContain('hello from plugin');
    });
});
