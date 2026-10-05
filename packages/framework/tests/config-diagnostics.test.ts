// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { ConfigRequirementError } from '../src/config-requirements';
import { logConfigRequirementFailure } from '../src/config-diagnostics';
const failure = () => new ConfigRequirementError({ code: 'COSSACK_CONFIG_REQUIRED_MISSING', name: 'API_TOKEN', kind: 'variable', severity: 'error', runtime: 'cloudflare', environment: 'staging', message: 'PRIVATE_SECRET_VALUE' });
afterEach(() => vi.restoreAllMocks());
it('logs exact declaration context without message, values, stack or extra properties', () => {
  const error = failure(); Object.defineProperty(error, 'extra', { get() { throw new Error('PRIVATE_ACCESSOR'); } });
  Object.defineProperty(error, 'message', { get() { throw new Error('PRIVATE_MESSAGE'); } });
  Object.defineProperty(error, 'stack', { get() { throw new Error('PRIVATE_STACK'); } });
  const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(logConfigRequirementFailure(error)).toBe(true);
  expect(logger.mock.calls).toEqual([[{ event: 'cossack.config.requirement.failed', code: 'COSSACK_CONFIG_REQUIRED_MISSING', requirementName: 'API_TOKEN', kind: 'variable', runtime: 'cloudflare', environment: 'staging' }]]);
  expect(JSON.stringify(logger.mock.calls)).not.toContain('PRIVATE');
});
it.each(['code', 'requirementName', 'kind', 'runtime', 'environment'])('rejects authored %s accessors without reading them', key => {
  const error = failure(); const getter = vi.fn(() => { throw new Error('PRIVATE_GETTER'); });
  Object.defineProperty(error, key, { get: getter }); const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(logConfigRequirementFailure(error)).toBe(false); expect(getter).not.toHaveBeenCalled(); expect(logger).not.toHaveBeenCalled();
});
it.each([['code', 'PRIVATE_CODE'], ['requirementName', 'SECRET\nVALUE'], ['requirementName', 'constructor'], ['kind', 'secret'], ['runtime', 'custom'], ['environment', '/private/file'], ['environment', 'x'.repeat(129)]])('rejects unsafe %s metadata', (key, value) => {
  const error = failure(); Object.defineProperty(error, key, { value }); const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(logConfigRequirementFailure(error)).toBe(false); expect(logger).not.toHaveBeenCalled();
});
it('rejects name forgery and hostile exception prototypes', () => {
  const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(logConfigRequirementFailure({ ...failure(), name: 'ConfigRequirementError' })).toBe(false);
  const forged = Object.assign(Object.create(ConfigRequirementError.prototype), failure());
  expect(logConfigRequirementFailure(forged)).toBe(false);
  expect(logConfigRequirementFailure(new Proxy({}, { getPrototypeOf() { throw new Error('PRIVATE_PROXY'); } }))).toBe(false);
  expect(logger).not.toHaveBeenCalled();
});
it('supports metadata failures without fabricated runtime or environment', () => {
  const error = new ConfigRequirementError({ code: 'COSSACK_CONFIG_REQUIREMENTS_INVALID', name: 'requirements', kind: 'metadata', severity: 'error', message: 'PRIVATE' });
  const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(logConfigRequirementFailure(error)).toBe(true);
  expect(logger).toHaveBeenCalledWith({ event: 'cossack.config.requirement.failed', code: 'COSSACK_CONFIG_REQUIREMENTS_INVALID', requirementName: 'requirements', kind: 'metadata' });
});
