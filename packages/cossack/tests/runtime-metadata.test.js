import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@cossackframework/scaffold', () => ({ detectProjectRuntime: vi.fn() }));
vi.mock('../src/deployment.js', () => ({ inspectDeployment: vi.fn() }));
import { detectProjectRuntime } from '@cossackframework/scaffold';
import { inspectDeployment } from '../src/deployment.js';
import { inspectRuntimeMetadata } from '../src/runtime-metadata.js';
afterEach(() => vi.resetAllMocks());
const pages = [{ route: '/', source: '/src/pages/index.ts', extraction: { method: 'ast' }, transport: 'sse' }];
it('evaluates selected-environment bindings without exposing resource values', async () => {
  detectProjectRuntime.mockResolvedValue('cloudflare');
  inspectDeployment.mockResolvedValue({ summary: { bindings: [{ name: 'COSSACK_SSE', resource: 'PRIVATE_VALUE' }] } });
  const result = await inspectRuntimeMetadata('/app', pages, 'staging');
  expect(inspectDeployment).toHaveBeenCalledWith('/app', 'staging');
  expect(result.transports[0].status).toBe('available');
  expect(JSON.stringify(result)).not.toContain('PRIVATE_VALUE');
  expect(result.diagnostics).toEqual([]);
});
it('reports missing transport bindings and unreadable configuration', async () => {
  detectProjectRuntime.mockResolvedValue('cloudflare');
  inspectDeployment.mockResolvedValue({ summary: { bindings: [] } });
  expect((await inspectRuntimeMetadata('/app', pages)).diagnostics[0].code).toBe('COSSACK_TRANSPORT_BINDING_MISSING');
  inspectDeployment.mockRejectedValue(new Error('PRIVATE_PARSER_TEXT'));
  const failed = await inspectRuntimeMetadata('/app', pages);
  expect(failed.status).toBe('unknown');
  expect(JSON.stringify(failed)).not.toContain('PRIVATE_PARSER_TEXT');
});
it('distinguishes process-local support from durable coordination', async () => {
  detectProjectRuntime.mockResolvedValue('node');
  const result = await inspectRuntimeMetadata('/app', [{ ...pages[0], transport: 'durable-object' }]);
  expect(result.transports[0].status).toBe('available');
  expect(result.capabilities.realtimeCoordination.status).toBe('unsupported');
  expect(inspectDeployment).not.toHaveBeenCalled();
});
it('does not guess an unrecorded runtime', async () => {
  detectProjectRuntime.mockResolvedValue(undefined);
  expect(await inspectRuntimeMetadata('/app', pages)).toMatchObject({ name: 'unknown', status: 'unknown', transports: [] });
});
