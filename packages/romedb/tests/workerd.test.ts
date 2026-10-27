import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liveRomeDBTests, startRomeDBService, type RomeDBTestService } from '../src/testing';

/** Qualifies the Web API client and the Durable Object pending store inside workerd. */
const live = liveRomeDBTests() ? describe : describe.skip;

live('RomeDB on workerd', () => {
    let service: RomeDBTestService;
    let mf: Miniflare;

    beforeAll(async () => {
        service = await startRomeDBService();
        const bundle = await build({
            entryPoints: [fileURLToPath(new URL('./fixtures/worker.ts', import.meta.url))],
            bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', write: false,
        });
        mf = new Miniflare({
            modules: true,
            script: bundle.outputFiles[0]!.text,
            compatibilityDate: '2026-07-01',
            bindings: { ROMEDB_URL: service.url, ROMEDB_TOKEN: service.token },
            durableObjects: { ROMEDB_PENDING: 'RomeDBPendingWrites' },
        });
    }, 30_000);

    afterAll(async () => {
        await mf?.dispose();
        await service?.stop();
    });

    it('runs typed reads, atomic writes and exact recovery without nodejs_compat', async () => {
        const response = await mf.dispatchFetch(`http://worker/?suffix=${Math.random().toString(36).slice(2, 8)}`);
        const text = await response.text();
        expect(response.headers.get('content-type'), text).toContain('json');
        const body = JSON.parse(text) as { [key: string]: unknown };
        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(body).toMatchObject({
            int: '9223372036854775807', float: 1, floatTyped: true, recordKey: '7', recordKeyType: 'bigint',
            uncertain: true, pendingBefore: 1, n: '2', pendingAfter: 0,
        });
        expect((body.report as { confirmed: string[] }).confirmed).toHaveLength(1);
        expect(body.engine).toMatch(/^0\./);
    });
});
