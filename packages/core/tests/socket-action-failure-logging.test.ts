// @vitest-environment node
import 'reflect-metadata';
import { Hono, type Context } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { Server } from '../src/shared/decorators';
import { ClientVisibleError } from '../src/shared/errors';
import { RpcError } from '../src/shared/rpc-stream';

const id = '12345678-1234-4123-8123-123456789abc';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function context() {
    let result!: Context;
    const app = new Hono();
    app.get('/items', c => { c.header('X-Cossack-Request-Id', id); result = c; return c.text('ok'); });
    await app.request('/items');
    return result;
}

const internalRecords = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls
    .map(([record]) => record as any)
    .filter(record => record?.event === 'cossack.runtime.failure' && record.code === 'COSSACK_RPC_INTERNAL_ERROR');

class Actions extends Cossack {
    @Server() visible() { throw new ClientVisibleError('Name is taken'); }
    @Server() limited() { throw new RpcError('COSSACK_RPC_RATE_LIMITED', 'Slow down'); }
    @Server() cancelled() { throw new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.'); }
    @Server() broken() { throw new Error('database exploded'); }
}

async function run(action: string) {
    const page = new Actions();
    const request = await context();
    await page.bootstrap({ context: request, runtime: { platform: 'web', adapter: 'node' }, skipInit: true });
    const socket = { send: vi.fn(), readyState: 1 };
    await page.executeAction(action, [], undefined, socket, id, request);
    await page.destroyAsync();
    return socket;
}

describe('socket action failure logging', () => {
    it.each(['visible', 'limited', 'cancelled'])('does not log %s failures as internal errors', async (action) => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const socket = await run(action);
        expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ type: 'error', requestId: id });
        expect(internalRecords(errors)).toEqual([]);
    });

    it('logs genuinely internal failures and, in development, the exception itself', async () => {
        vi.stubEnv('DEV', true);
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const socket = await run('broken');
        expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ code: 'COSSACK_RPC_INTERNAL_ERROR', message: 'Internal Server Error' });
        expect(internalRecords(errors)).toHaveLength(1);
        expect(errors.mock.calls.some(call => call.some(arg => arg instanceof Error && arg.message === 'database exploded'))).toBe(true);
    });

    it('keeps production logs redacted', async () => {
        vi.stubEnv('DEV', false);
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        await run('broken');
        expect(internalRecords(errors)).toHaveLength(1);
        expect(JSON.stringify(errors.mock.calls)).not.toContain('database exploded');
        expect(errors.mock.calls.some(call => call.some(arg => arg instanceof Error))).toBe(false);
    });
});
