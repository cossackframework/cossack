import { expect, it } from 'vitest';
import * as nodeAdapter from '../src/index';

it('exposes createNodeAdapter as the only WebSocket runtime entry point', () => {
  expect(typeof nodeAdapter.createNodeAdapter).toBe('function');
  // The legacy registry adapter hardcoded http:// (rejecting every upgrade
  // behind TLS) and bypassed framework middleware. It is removed with its helpers.
  expect(Object.keys(nodeAdapter)).not.toContain('CossackNodeAdapter');
  expect(Object.keys(nodeAdapter)).not.toContain('NodeWebSocketRuntime');
  expect(Object.keys(nodeAdapter)).not.toContain('nodeRuntimeAdapter');
});
