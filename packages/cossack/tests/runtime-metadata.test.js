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
it.each(['node'])('reports missing schedule integration without rejecting unrelated %s routes', async runtime => {
  detectProjectRuntime.mockResolvedValue(runtime);
  const result = await inspectRuntimeMetadata('/app', [{ ...pages[0], transport: 'http' }]);
  expect(result.capabilities.scheduledHandlers.status).toBe('adapter-required');
  expect(result.transports[0].status).toBe('available');
  expect(result.diagnostics).toEqual([]);
});
it.each(['node'])('rejects stateful WebSocket pages on %s while permitting ephemeral state', async runtime => {
  detectProjectRuntime.mockResolvedValue(runtime);
  const stateful = { ...pages[0], transport: 'durable-object', stateful: true };
  const result = await inspectRuntimeMetadata('/app', [stateful]);
  expect(result.transports[0].status).toBe('available');
  expect(result.diagnostics).toContainEqual(expect.objectContaining({
    code: 'COSSACK_CAPABILITY_UNSUPPORTED', capability: 'durableState', source: stateful.source, severity: 'error',
  }));
  expect((await inspectRuntimeMetadata('/app', [{ ...stateful, stateful: false }])).diagnostics).toEqual([]);
});

it('checks selected recipe requirements through the shared capability model', async () => {
  detectProjectRuntime.mockResolvedValue('cloudflare');
  inspectDeployment.mockResolvedValue({ summary: { bindings: [] } });
  const result = await inspectRuntimeMetadata('/app', [], undefined, [{
    feature: 'database/sqlite', source: { file: '.cossack/scaffold.json' }, requires: { filesystem: true },
  }]);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({
    code: 'COSSACK_CAPABILITY_UNSUPPORTED', source: '.cossack/scaffold.json', feature: 'database/sqlite',
  }));
});
it('reports native database binding requirements from selected recipes', async () => {
  detectProjectRuntime.mockResolvedValue('cloudflare');
  inspectDeployment.mockResolvedValue({ summary: { bindings: [] } });
  const requirements = [{ feature: 'database/d1', source: { file: '.cossack/scaffold.json' }, requires: { cloudflareBindings: ['DB'] } }];
  expect((await inspectRuntimeMetadata('/app', [], undefined, requirements)).diagnostics)
    .toContainEqual(expect.objectContaining({ code: 'COSSACK_CAPABILITY_BINDING_MISSING', missingBindings: ['DB'] }));
  inspectDeployment.mockResolvedValue({ summary: { bindings: [{ name: 'DB', resource: 'PRIVATE_VALUE' }] } });
  const result = await inspectRuntimeMetadata('/app', [], undefined, requirements);
  expect(result.diagnostics).toEqual([]);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_VALUE');
});
