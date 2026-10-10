import { describe, expect, it } from 'vitest';
import * as coreCapabilities from '@cossackframework/core/runtime-capabilities';
import {
    describeRuntimeCapabilities,
    evaluateCapability,
    evaluateTransportCapability,
    formatCapabilityResult,
    supportsTransport,
} from '../src/runtime-capabilities';

describe('runtime capability model (RT-25)', () => {
    it('re-exports the core model used by library-level scaffold planning', () => {
        expect(evaluateCapability).toBe(coreCapabilities.evaluateCapability);
        expect(evaluateTransportCapability).toBe(coreCapabilities.evaluateTransportCapability);
        expect(describeRuntimeCapabilities).toBe(coreCapabilities.describeRuntimeCapabilities);
    });
    it('does not advertise scheduled dispatch from the built-in Node adapter', () => {
        for (const runtime of ['node'] as const) {
            const result = evaluateCapability(runtime, 'scheduledHandlers', {});
            expect(result).toEqual({ capability: 'scheduledHandlers', status: 'adapter-required', missingBindings: [] });
            expect(formatCapabilityResult(result)).toContain('not provided by the built-in runtime adapter');
            expect(describeRuntimeCapabilities(runtime, {}).scheduledHandlers).toEqual(result);
        }
        expect(evaluateCapability('cloudflare', 'scheduledHandlers', {})).toMatchObject({ status: 'available' });
        expect(evaluateCapability('desktop', 'scheduledHandlers', {})).toMatchObject({ status: 'unsupported' });
    });
    it('cloudflare gains durable coordination only with the COSSACK_SSE binding', () => {
        const without = evaluateCapability('cloudflare', 'realtimeCoordination', {});
        expect(without).toMatchObject({ status: 'missing-binding', missingBindings: ['COSSACK_SSE'] });
        const withBinding = evaluateCapability('cloudflare', 'realtimeCoordination', { COSSACK_SSE: {} });
        expect(withBinding).toMatchObject({ status: 'available', missingBindings: [] });
    });

    it('node exposes process-local realtime but not durable coordination', () => {
        for (const runtime of ['node'] as const) {
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
        expect(supportsTransport('unknown', 'http')).toBe(false);
    });

    it('requires transport-specific bindings only on Cloudflare', () => {
        expect(evaluateTransportCapability('cloudflare', 'http', {})).toMatchObject({ status: 'available' });
        expect(evaluateTransportCapability('cloudflare', 'sse', {})).toMatchObject({ status: 'missing-binding', missingBindings: ['COSSACK_SSE'] });
        expect(evaluateTransportCapability('cloudflare', 'durable-object', {})).toMatchObject({ status: 'missing-binding', missingBindings: ['COSSACK_OBJECT'] });
        expect(evaluateTransportCapability('cloudflare', 'sse', { COSSACK_SSE: {} })).toMatchObject({ status: 'available' });
        for (const runtime of ['node'] as const) {
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
            'scheduledHandlers', 'serverlessStorage', 'filesystem', 'durableState', 'cloudflareBindings',
        ]);
        expect(formatCapabilityResult(results.realtimeCoordination))
            .toBe('realtimeCoordination: missing binding(s) COSSACK_SSE');
        expect(formatCapabilityResult(results.filesystem)).toBe('filesystem: unsupported on this runtime');
        const full = describeRuntimeCapabilities('cloudflare', { COSSACK_SSE: {} });
        expect(formatCapabilityResult(full.realtimeCoordination)).toBe('realtimeCoordination: available');
    });
});

it('distinguishes durable page storage from process-local WebSocket support', () => {
  for (const runtime of ['node', 'desktop'] as const) {
    expect(evaluateCapability(runtime, 'durableState', {})).toMatchObject({ status: 'unsupported' });
  }
  expect(evaluateCapability('cloudflare', 'durableState', {})).toMatchObject({ status: 'missing-binding', missingBindings: ['COSSACK_OBJECT'] });
  expect(evaluateCapability('cloudflare', 'durableState', { COSSACK_OBJECT: {} })).toMatchObject({ status: 'available' });
});

it('requires native named bindings and rejects process runtime polyfill assumptions', () => {
  expect(evaluateCapability('cloudflare', 'cloudflareBindings', {}, ['DB', 'HYPERDRIVE', 'DB']))
    .toMatchObject({ status: 'missing-binding', missingBindings: ['DB', 'HYPERDRIVE'] });
  expect(evaluateCapability('cloudflare', 'cloudflareBindings', { DB: 'private' }, ['DB']))
    .toEqual({ capability: 'cloudflareBindings', status: 'available', missingBindings: [] });
  for (const runtime of ['node', 'desktop'] as const) {
    expect(evaluateCapability(runtime, 'cloudflareBindings', { DB: {} }, ['DB'])).toMatchObject({ status: 'unsupported' });
  }
});
