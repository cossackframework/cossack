// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Cossack, State } from '@cossackframework/core';
import { startDevelopmentTrace, createDevelopmentNavigationTrace } from '@cossackframework/core/devtools';
import { parseDevelopmentTrace, readDevelopmentTraces, writeDevelopmentTrace } from '../src/development-traces';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function root() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-trace-store-')); roots.push(dir); return dir; }
const snapshot = () => ({ schemaVersion: 1, sessionId: randomUUID(), startedAt: Date.now(), capturedAt: Date.now(), collecting: true, capacity: 512, dropped: 0, events: [], components: { entries: [], dropped: 0, tracking: 'weak' } });
it('round trips a real core snapshot with navigation and passive component fields', async () => {
    class Page extends Cossack { @State() count = 3; }
    const page = new Page(); page.connectedCallback(); const capture = startDevelopmentTrace();
    try {
        capture.inspect(page);
        const navigation = createDevelopmentNavigationTrace(1)!;
        navigation.record({ phase: 'start', navigationType: 'push' });
        navigation.component(page, 'page'); navigation.record({ phase: 'finish', outcome: 'completed', committed: true });
        const before = capture.snapshot(), json = JSON.stringify(before);
        expect(parseDevelopmentTrace(json)).toEqual(before);
        const dir = await root(); expect((await readDevelopmentTraces(dir)).data.status).toBe('missing');
        await writeDevelopmentTrace(dir, randomUUID(), json);
        const read = await readDevelopmentTraces(dir);
        expect(read.data.record?.snapshot).toEqual(before);
        expect(read.data.freshness).toMatchObject({ status: 'recorded-snapshot', live: false });
        expect((await readDevelopmentTraces(dir, { session: randomUUID() })).data.status).toBe('missing');
    } finally { capture.stop(); await page.destroyAsync(); }
});
it('rejects payloads, selected state values, invalid event fields and over-limit records', () => {
    const s: any = snapshot();
    for (const bad of [{ ...s, secret: 'private' }, { ...s, capacity: 2049 }, { ...s, events: [{ kind: 'rpc', secret: 'private' }] },
        { ...s, components: { ...s.components, entries: Array(65).fill({}) } }]) expect(() => parseDevelopmentTrace(JSON.stringify(bad))).toThrow();
    expect(() => parseDevelopmentTrace(' '.repeat(2 * 1024 * 1024 + 1))).toThrow();
    const details = { lifecycle: 'Mounted', state: { fields: [{ name: 'count', visibility: 'public', value: { type: 'number', value: 3 } }], truncated: false }, resources: { entries: [], truncated: false }, scopes: { entries: [], truncated: false }, transports: { entries: [], truncated: false } };
    s.components.entries = [{ componentId: 1, capturedAt: Date.now(), status: 'available', details }];
    expect(() => parseDevelopmentTrace(JSON.stringify(s))).toThrow();
    details.state.fields[0].value = { type: 'omitted' } as any;
    expect(parseDevelopmentTrace(JSON.stringify(s))).toEqual(s);
});
it('bounds retained sessions and reads a specifically selected session', async () => {
    const dir = await root(), server = randomUUID(), sessions: string[] = [];
    for (let i = 0; i < 18; i++) { const s = snapshot(); sessions.push(s.sessionId); await writeDevelopmentTrace(dir, server, JSON.stringify(s)); }
    const files = await fs.readdir(path.join(dir, '.cossack/development-traces')); expect(files).toHaveLength(16);
    expect((await readDevelopmentTraces(dir, { session: sessions[17] })).data.record?.snapshot.sessionId).toBe(sessions[17]);
    await expect(readDevelopmentTraces(dir, { session: '../../secret' })).rejects.toMatchObject({ code: 'COSSACK_TRACE_SESSION_INVALID' });
});
it('rejects linked directories, linked records, malformed JSON and copied project evidence', async () => {
    const dir = await root(), outside = await root(); await fs.symlink(outside, path.join(dir, '.cossack'));
    await expect(writeDevelopmentTrace(dir, randomUUID(), JSON.stringify(snapshot()))).rejects.toMatchObject({ code: 'COSSACK_TRACE_PATH' });
    await fs.unlink(path.join(dir, '.cossack'));
    const s = snapshot(); await writeDevelopmentTrace(dir, randomUUID(), JSON.stringify(s));
    await fs.cp(path.join(dir, '.cossack'), path.join(outside, '.cossack'), { recursive: true });
    await expect(readDevelopmentTraces(outside)).rejects.toMatchObject({ code: 'COSSACK_TRACE_PROJECT' });
    const file = path.join(dir, '.cossack/development-traces', s.sessionId + '.json'); await fs.unlink(file); await fs.symlink(path.join(outside, '.cossack/development-traces', s.sessionId + '.json'), file);
    await expect(readDevelopmentTraces(dir)).rejects.toMatchObject({ code: 'COSSACK_TRACE_INVALID' });
    await fs.unlink(file); await fs.writeFile(file, '{');
    await expect(readDevelopmentTraces(dir)).rejects.toMatchObject({ code: 'COSSACK_TRACE_INVALID' });
});

it('installs no browser bridge by default and emits an empty virtual module for production', async () => {
    const { createServer, build } = await import('vite');
    const { cossackPages } = await import('../src/vite-plugin');
    const dir = await root(); await fs.mkdir(path.join(dir, 'src/pages'), { recursive: true });
    const server = await createServer({ root: dir, configFile: false, logLevel: 'silent', plugins: [cossackPages()] });
    try { expect(await server.transformIndexHtml('/', '<html><body></body></html>')).not.toContain('virtual:cossack-development-traces'); }
    finally { await server.close(); }
    const entry = path.join(dir, 'production.js'); await fs.writeFile(entry, "export * from 'virtual:cossack-development-traces';");
    const result = await build({ root: dir, configFile: false, logLevel: 'silent', mode: 'production', plugins: [cossackPages({ developmentTraces: true })],
        build: { write: false, minify: false, lib: { entry, formats: ['es'], fileName: 'bridge' } } });
    const bundles = Array.isArray(result) ? result : [result];
    const code = bundles.flatMap(bundle => 'output' in bundle ? bundle.output : []).filter(chunk => chunk.type === 'chunk').map(chunk => chunk.code).join('\n');
    expect(code.trim()).toBe('');
});

it('separates bridge instances, rejects overload without queueing and removes its receiver on close', async () => {
    const { EventEmitter } = await import('node:events');
    const { installDevelopmentTraceBridge, TRACE_BRIDGE_EVENT } = await import('../src/vite-development-traces');
    const dir = await root(), ws = new EventEmitter(), httpServer = new EventEmitter();
    const bridge = installDevelopmentTraceBridge({ ws, httpServer } as any, dir);
    const replies: any[] = [], client = { send: (event: string, value: any) => replies.push({ event, ...value }) };
    ws.emit(TRACE_BRIDGE_EVENT, { token: 'wrong-server', id: '1', json: JSON.stringify(snapshot()) }, client);
    expect(replies).toEqual([]); expect((await readDevelopmentTraces(dir)).data.status).toBe('missing');
    const s = snapshot();
    ws.emit(TRACE_BRIDGE_EVENT, { token: bridge.token, id: '2', json: JSON.stringify(s) }, client);
    ws.emit(TRACE_BRIDGE_EVENT, { token: bridge.token, id: '3', json: JSON.stringify(snapshot()) }, client);
    expect(replies).toContainEqual({ event: TRACE_BRIDGE_EVENT + ':ack', id: '3', status: 'busy' });
    await expect.poll(() => replies.some(reply => reply.id === '2' && reply.status === 'saved')).toBe(true);
    expect((await readDevelopmentTraces(dir)).data.record?.snapshot.sessionId).toBe(s.sessionId);
    httpServer.emit('close'); expect(ws.listenerCount(TRACE_BRIDGE_EVENT)).toBe(0); bridge.dispose();
});
