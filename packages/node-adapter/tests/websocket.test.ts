import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Cossack } from '@cossackframework/core';
import { CossackNodeAdapter } from '../src/index';

describe('CossackNodeAdapter WebSockets', () => {
    const servers: ReturnType<typeof createServer>[] = [];

    afterEach(async () => {
        await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
            server.close(() => resolve());
        })));
    });

    it('accepts current routePath metadata and exposes decoded route params', async () => {
        let receivedParams: Record<string, string> | undefined;
        class CounterPage extends Cossack {
            override async bootstrap(options: any): Promise<void> {
                receivedParams = options.context.req.param();
            }

            override getInitialState() {
                return { public: { count: 0 } } as any;
            }
        }

        const server = createServer();
        servers.push(server);
        new CossackNodeAdapter({
            server,
            componentRegistry: new Map([['/counter/:id', CounterPage]]),
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing test server address');

        const origin = `http://127.0.0.1:${address.port}`;
        const query = new URLSearchParams({
            routePath: '/counter/:id',
            pathname: '/counter/42',
            params: JSON.stringify({ id: '42' }),
        });
        const socket = new WebSocket(
            `ws://127.0.0.1:${address.port}/ws/page/user:anonymous?${query}`,
            { headers: { origin } },
        );
        try {
            const state = await new Promise<any>((resolve, reject) => {
                socket.once('error', reject);
                socket.once('message', (data) => resolve(JSON.parse(data.toString())));
            });
            expect(state).toEqual({ type: 'state-update', state: { public: { count: 0 } } });
            expect(receivedParams).toEqual({ id: '42' });
        } finally {
            socket.close();
            await new Promise<void>((resolve) => socket.once('close', () => resolve()));
        }
    });

    it('rejects a client-supplied scope belonging to another instance', async () => {
        class CounterPage extends Cossack {}
        const server = createServer();
        servers.push(server);
        new CossackNodeAdapter({
            server,
            componentRegistry: new Map([['/counter', CounterPage]]),
            defaultUser: { id: 'current-user' },
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing test server address');

        const origin = `http://127.0.0.1:${address.port}`;
        const query = new URLSearchParams({ routePath: '/counter', params: '{}' });
        const socket = new WebSocket(
            `ws://127.0.0.1:${address.port}/ws/page/user:other-user?${query}`,
            { headers: { origin } },
        );
        const closed = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
            socket.once('error', reject);
            socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
        });
        expect(closed).toEqual({ code: 1008, reason: 'Invalid WebSocket scope' });
    });
});
