import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { snapshotSocketRequest, socketRequestContext } from '../src/shared/socket-context';
import { defaultRateLimitKey } from '../src/shared/rate-limit';

describe('socket upgrade context', () => {
    it('keeps headers, queries, route params and environment without retaining HTTP credentials', () => {
        const snapshot = snapshotSocketRequest(new Request('https://example.test/ws/id?filter=active', { headers: {
            'CF-Connecting-IP': '192.0.2.1', 'X-Bucket': 'public', Cookie: 'session=PRIVATE',
            Authorization: 'Bearer PRIVATE', 'X-User-Data': '{"id":"PRIVATE"}',
            'X-Component-Path': '/internal', 'Sec-WebSocket-Key': 'handshake',
        } }), { tenant: 'example' });
        const env = { MARK: 'worker' };
        const context = socketRequestContext(snapshot, env, undefined);
        expect(context.req.header('x-bucket')).toBe('public');
        expect(context.req.header('cf-connecting-ip')).toBe('192.0.2.1');
        expect(context.req.header('cookie')).toBeUndefined();
        expect(context.req.header('authorization')).toBeUndefined();
        expect(context.req.header('x-user-data')).toBeUndefined();
        expect(context.req.header('sec-websocket-key')).toBeUndefined();
        expect(context.req.query('filter')).toBe('active');
        expect(context.req.param('tenant')).toBe('example');
        expect(context.req.param('constructor')).toBeUndefined();
        expect(context.req.path).toBe('/ws/id');
        expect(context.req.url).toBe(snapshot.url);
        expect(context.env).toBe(env);
        expect(context.get('user')).toBeUndefined();
        // Off Cloudflare the header is client-controlled and ignored.
        expect(defaultRateLimitKey(context)).toBe('ip:anonymous');
        vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
        try { expect(defaultRateLimitKey(context)).toBe('ip:192.0.2.1'); }
        finally { vi.unstubAllGlobals(); }
        expect(JSON.stringify(snapshot)).not.toContain('PRIVATE');
    });

    it('uses verified user identity and isolates mutable context variables per action', () => {
        const snapshot = snapshotSocketRequest(new Request('https://example.test/ws'), { tenant: 'original' });
        const first = socketRequestContext(snapshot, {}, { id: 'first' });
        const second = socketRequestContext(snapshot, {}, { id: 'second' });
        first.set('custom', 'first-only');
        expect(second.get('custom')).toBeUndefined();
        expect(defaultRateLimitKey(first)).toBe('user:first');
        expect(defaultRateLimitKey(second)).toBe('user:second');
        first.req.param().tenant = 'changed';
        expect(first.req.param('tenant')).toBe('original');
        expect(second.req.param('tenant')).toBe('original');
    });
});
