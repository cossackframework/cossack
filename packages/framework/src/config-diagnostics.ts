import { isConfigRequirementError } from './config-requirements.js';

const CODES = new Set([
  'COSSACK_CONFIG_REQUIREMENTS_INVALID', 'COSSACK_CONFIG_REQUIREMENT_CONFLICT',
  'COSSACK_CONFIG_VALUE_UNREADABLE', 'COSSACK_CONFIG_REQUIRED_MISSING',
  'COSSACK_CONFIG_VARIABLE_INVALID', 'COSSACK_CONFIG_BINDING_INVALID',
  'COSSACK_CONFIG_RUNTIME_UNSUPPORTED', 'COSSACK_CONFIG_REQUIREMENT_UNDECLARED',
  'COSSACK_CONFIG_VARIABLE_TYPE_MISMATCH',
]);
const RUNTIMES = new Set(['cloudflare', 'node', 'desktop', 'unknown', 'ssg']);
const KINDS = new Set(['variable', 'binding', 'metadata']);
const declaredIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value)
  && !['__proto__', 'constructor', 'prototype'].includes(value);
const environmentIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);

/** Log only fixed codes and safe declaration identities; exception contents stay private. */
export function logConfigRequirementFailure(error: unknown): boolean {
  try {
    if (!isConfigRequirementError(error)) return false;
    const values: Record<string, unknown> = Object.create(null);
    for (const key of ['code', 'requirementName', 'kind', 'runtime', 'environment']) {
      const descriptor = Object.getOwnPropertyDescriptor(error, key);
      if (!descriptor || !('value' in descriptor)) return false;
      values[key] = descriptor.value;
    }
    if (typeof values.code !== 'string' || !CODES.has(values.code)
      || !declaredIdentifier(values.requirementName)
      || typeof values.kind !== 'string' || !KINDS.has(values.kind)
      || (values.runtime !== undefined && (typeof values.runtime !== 'string' || !RUNTIMES.has(values.runtime)))
      || (values.environment !== undefined && !environmentIdentifier(values.environment))) return false;
    console.error({
      event: 'cossack.config.requirement.failed', code: values.code,
      requirementName: values.requirementName, kind: values.kind,
      ...(values.runtime !== undefined ? { runtime: values.runtime } : {}),
      ...(values.environment !== undefined ? { environment: values.environment } : {}),
    });
    return true;
  } catch { return false; }
}
