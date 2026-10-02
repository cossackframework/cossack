import { describe, expect, it } from 'vitest';
import {
    describeRuntimeCapabilities,
    evaluateCapability,
    evaluateTransportCapability,
    formatCapabilityResult,
    supportsTransport,
} from '../src/runtime-capabilities';

describe('runtime capability model (RT-25)', () => {
    it('cloudflare gains durable coordination only with the COSSACK_SSE binding', () => {
        const without = evaluateCapability('cloudflare', 'realtimeCoordination', {});
        expect(without).toMatchObject({ status: 'missing-binding', missingBindings: ['COSSACK_SSE'] });
        const withBinding = evaluateCapability('cloudflare', 'realtimeCoordination', { COSSACK_SSE: {} });
        expect(withBinding).toMatchObject({ status: 'available', missingBindings: [] });
    });

    it('node and deno expose process-local realtime but not durable coordination', () => {
        for (const runtime of ['node', 'deno'] as const) {
            expect(evaluateCapability(runtime, 'realtimeCoordination', {})).toMatchObject({ status: 'unsupported' });
            expect(evaluateCapability(runtime, 'processLocalRealtime', {})).toMatchObject({ status: 'available' });
            expect(evaluateCapability(runtime, 'filesystem', {})).toMatchObject({ status: 'available' });
        }
    });

    it('desktop keeps its HTTP-only boundary', () => {
        expect(supportsTransport('desktop', 'http')).toBe(true);
        expect(supportsTransport('desktop', 'sse')).toBe(false);
        expect(supportsTransport('desktop', 'durable-object')).toBe(false);
        expect(evaluateCapability('desktop', 'scheduledHandlers', {})).toMatchObject({ status: 'unsupported' });
    });

    it('transport support differs per runtime', () => {
        expect(supportsTransport('cloudflare', 'durable-object')).toBe(true);
        expect(supportsTransport('node', 'durable-object')).toBe(true);
        expect(supportsTransport('deno', 'durable-object')).toBe(true);
        expect(supportsTransport('unknown', 'http')).toBe(false);
    });

    it('requires transport-specific bindings only on Cloudflare', () => {
        expect(evaluateTransportCapability('cloudflare', 'http', {})).toMatchObject({ status: 'available' });
        expect(evaluateTransportCapability('cloudflare', 'sse', {})).toMatchObject({ status: 'missing-binding', missingBindings: ['COSSACK_SSE'] });
        expect(evaluateTransportCapability('cloudflare', 'durable-object', {})).toMatchObject({ status: 'missing-binding', missingBindings: ['COSSACK_OBJECT'] });
        expect(evaluateTransportCapability('cloudflare', 'sse', { COSSACK_SSE: {} })).toMatchObject({ status: 'available' });
        for (const runtime of ['node', 'deno'] as const) {
            expect(evaluateTransportCapability(runtime, 'durable-object', {})).toMatchObject({ status: 'available' });
            expect(evaluateCapability(runtime, 'realtimeCoordination', {})).toMatchObject({ status: 'unsupported' });
        }
    });

    it('evaluates requested transports instead of accepting every request', () => {
        expect(evaluateCapability('desktop', 'transports', {}, ['sse'])).toMatchObject({ status: 'unsupported' });
        expect(evaluateCapability('cloudflare', 'transports', {}, ['sse', 'durable-object'])).toMatchObject({ status: 'missing-binding', missingBindings: ['COSSACK_SSE', 'COSSACK_OBJECT'] });
        expect(evaluateTransportCapability('node', 'not-a-transport', {})).toMatchObject({ status: 'unsupported' });
    });

    it('summarizes every capability with names only', () => {
        const results = describeRuntimeCapabilities('cloudflare', {});
        expect(Object.keys(results)).toEqual([
            'transports', 'realtimeCoordination', 'processLocalRealtime',
            'scheduledHandlers', 'serverlessStorage', 'filesystem',
        ]);
        expect(formatCapabilityResult(results.realtimeCoordination))
            .toBe('realtimeCoordination: missing binding(s) COSSACK_SSE');
        expect(formatCapabilityResult(results.filesystem)).toBe('filesystem: unsupported on this runtime');
        const full = describeRuntimeCapabilities('cloudflare', { COSSACK_SSE: {} });
        expect(formatCapabilityResult(full.realtimeCoordination)).toBe('realtimeCoordination: available');
    });
});
