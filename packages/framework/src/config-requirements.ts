/** Portable requirement metadata and value-free diagnostics. No tooling/runtime imports. */
import type { RuntimeName } from './runtime-capabilities.js';
export type ConfigRuntime = RuntimeName | 'ssg';
export type VariableType = 'string' | 'number' | 'boolean';
export type BindingKind = 'object' | 'd1' | 'kv' | 'r2' | 'durable-object' | 'service';
export type VariableValue<T extends VariableType> = T extends 'number' ? number : T extends 'boolean' ? boolean : string;
interface RequirementBase { required?: boolean; /** Apply only in these runtimes; omitted means all. */ runtimes?: readonly ConfigRuntime[]; }
export interface VariableRequirement extends RequirementBase { type: VariableType; coerce?: boolean; secret?: boolean; }
export interface BindingRequirement extends RequirementBase { kind: BindingKind; }
export interface ConfigRequirements { variables?: Readonly<Record<string, VariableRequirement>>; bindings?: Readonly<Record<string, BindingRequirement>>; }
export type ConfigRequirementCollection = Readonly<Record<string, ConfigRequirements>>;
export interface ConfigRequirementContext {
  runtime: ConfigRuntime;
  environment?: string;
  /** Declaration checks never prove remote resource or secret availability. */
  mode?: 'runtime' | 'declarations';
  bindingKinds?: Readonly<Record<string, BindingKind>>;
  secretNames?: readonly string[];
}
export interface ConfigRequirementDiagnostic {
  code: string; severity: 'error'; name: string; kind: 'variable' | 'binding' | 'metadata';
  source?: string; message: string; runtime?: ConfigRuntime; environment?: string;
}
const requirementErrors = new WeakSet<object>();
export function isConfigRequirementError(value: unknown): value is ConfigRequirementError {
  return typeof value === 'object' && value !== null && requirementErrors.has(value);
}
export class ConfigRequirementError extends Error {
  readonly code: string;
  readonly requirementName: string;
  readonly kind: ConfigRequirementDiagnostic['kind'];
  readonly runtime?: ConfigRuntime;
  readonly environment?: string;
  constructor(diagnostic: ConfigRequirementDiagnostic) {
    super(diagnostic.message); requirementErrors.add(this); this.name = 'ConfigRequirementError';
    this.code = diagnostic.code; this.requirementName = diagnostic.name; this.kind = diagnostic.kind;
    this.runtime = diagnostic.runtime; this.environment = diagnostic.environment;
  }
}

const RUNTIMES = new Set(['cloudflare', 'node', 'deno', 'desktop', 'unknown', 'ssg']);
const VARIABLE_TYPES = new Set(['string', 'number', 'boolean']);
const BINDING_KINDS = new Set(['object', 'd1', 'kv', 'r2', 'durable-object', 'service']);
function invalidMetadata(): never {
  throw new ConfigRequirementError({ code: 'COSSACK_CONFIG_REQUIREMENTS_INVALID', severity: 'error',
    kind: 'metadata', name: 'requirements', message: 'Configuration requirement metadata must use the documented literal schema.' });
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidMetadata();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalidMetadata();
  if (Object.getOwnPropertySymbols(value).length) return invalidMetadata();
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor)) return invalidMetadata();
  }
  return value as Record<string, unknown>;
}
function allowedKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalidMetadata();
}
/** Reject unknown fields/accessors without reading or serializing their values. */
export function normalizeConfigRequirements(value: unknown): ConfigRequirements {
  try {
    const input = record(value); allowedKeys(input, ['variables', 'bindings']);
    const output: ConfigRequirements = {};
    for (const group of ['variables', 'bindings'] as const) {
      if (!Object.hasOwn(input, group)) continue;
      const entries = record(input[group]); const result: Record<string, any> = Object.create(null);
      for (const name of Object.keys(entries).sort()) {
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) invalidMetadata();
        const rule = record(entries[name]);
        allowedKeys(rule, group === 'variables' ? ['type', 'required', 'coerce', 'secret', 'runtimes'] : ['kind', 'required', 'runtimes']);
        for (const field of ['required', 'coerce', 'secret']) {
          if (Object.hasOwn(rule, field) && typeof rule[field] !== 'boolean') invalidMetadata();
        }
        const selector = group === 'variables' ? 'type' : 'kind';
        if (!Object.hasOwn(rule, selector) || !(group === 'variables' ? VARIABLE_TYPES : BINDING_KINDS).has(rule[selector] as string)) invalidMetadata();
        const normalized: Record<string, unknown> = { [selector]: rule[selector], required: Object.hasOwn(rule, 'required') ? rule.required : true };
        if (group === 'variables') { normalized.coerce = Object.hasOwn(rule, 'coerce') ? rule.coerce : false; normalized.secret = Object.hasOwn(rule, 'secret') ? rule.secret : false; }
        if (Object.hasOwn(rule, 'runtimes')) {
          const list = rule.runtimes;
          if (!Array.isArray(list) || Object.getPrototypeOf(list) !== Array.prototype || Object.getOwnPropertySymbols(list).length) invalidMetadata();
          const descriptors = Object.getOwnPropertyDescriptors(list);
          if (list.length > 64 || Object.keys(descriptors).some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))) invalidMetadata();
          const runtimes: ConfigRuntime[] = [];
          for (let index = 0; index < list.length; index++) {
            const descriptor = descriptors[String(index)];
            if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string' || !RUNTIMES.has(descriptor.value)) invalidMetadata();
            if (!runtimes.includes(descriptor.value as ConfigRuntime)) runtimes.push(descriptor.value as ConfigRuntime);
          }
          normalized.runtimes = runtimes.sort();
        }
        result[name] = normalized;
      }
      output[group] = result;
    }
    return output;
  } catch { return invalidMetadata(); }
}
function diagnostic(code: string, kind: ConfigRequirementDiagnostic['kind'], name: string, reason: string,
  context: ConfigRequirementContext): ConfigRequirementDiagnostic {
  return { code, severity: 'error', kind, name, runtime: context.runtime,
    ...(context.environment !== undefined ? { environment: context.environment } : {}),
    message: `Configuration ${kind} "${name}" ${reason} (runtime: ${context.runtime}${context.environment !== undefined ? `; environment: ${context.environment}` : ''}).` };
}
function parseVariable(value: unknown, rule: VariableRequirement): string | number | boolean | undefined {
  if (rule.type === 'string') return typeof value === 'string' ? value : undefined;
  if (rule.type === 'number') {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (rule.coerce && typeof value === 'string') {
      const text = value.trim();
      if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) {
        const number = Number(text); if (Number.isFinite(number)) return number;
      }
    }
    return undefined;
  }
  if (typeof value === 'boolean') return value;
  if (rule.coerce) {
    const candidate = typeof value === 'string' ? value.trim() : value;
    if (candidate === 'true' || candidate === '1' || candidate === 1) return true;
    if (candidate === 'false' || candidate === '0' || candidate === 0) return false;
  }
  return undefined;
}
const METHODS: Record<Exclude<BindingKind, 'object'>, readonly string[]> = {
  d1: ['prepare', 'batch'], kv: ['get', 'put', 'delete'], r2: ['get', 'put', 'delete', 'head'],
  'durable-object': ['idFromName', 'get'], service: ['fetch'],
};
function matchesBinding(value: unknown, kind: BindingKind): boolean {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  if (kind === 'object') return true;
  return METHODS[kind].every(method => typeof (value as Record<string, unknown>)[method] === 'function');
}
/** Validate all active requirements before evaluating factories; values remain private. */
export function checkConfigRequirements(collection: ConfigRequirementCollection, envBindings: Record<string, unknown>,
  context: ConfigRequirementContext) {
  const diagnostics: ConfigRequirementDiagnostic[] = [];
  const variables: Record<string, string | number | boolean> = Object.create(null);
  const variableTypes: Record<string, VariableType> = Object.create(null);
  const unverifiedSecrets = new Set<string>();
  const active: { variables: Record<string, VariableRequirement>; bindings: Record<string, BindingRequirement> } = {
    variables: Object.create(null), bindings: Object.create(null),
  };
  let metadataEntries: unknown[];
  try { metadataEntries = Object.values(record(collection)); }
  catch { diagnostics.push(diagnostic('COSSACK_CONFIG_REQUIREMENTS_INVALID', 'metadata', 'requirements', 'has invalid metadata', context)); metadataEntries = []; }
  for (const metadata of metadataEntries) {
    let normalized: ConfigRequirements;
    try { normalized = normalizeConfigRequirements(metadata); }
    catch { diagnostics.push(diagnostic('COSSACK_CONFIG_REQUIREMENTS_INVALID', 'metadata', 'requirements', 'has invalid metadata', context)); continue; }
    for (const group of ['variables', 'bindings'] as const) {
      for (const [name, rule] of Object.entries(normalized[group] ?? {})) {
        if (rule.runtimes && !rule.runtimes.includes(context.runtime)) continue;
        const rules = active[group] as Record<string, VariableRequirement & BindingRequirement>;
        const previous = rules[name];
        if (previous && ((group === 'variables' && (previous.type !== (rule as VariableRequirement).type || previous.coerce !== (rule as VariableRequirement).coerce))
          || (group === 'bindings' && previous.kind !== (rule as BindingRequirement).kind))) {
          diagnostics.push(diagnostic('COSSACK_CONFIG_REQUIREMENT_CONFLICT', group === 'variables' ? 'variable' : 'binding', name, 'has incompatible declarations', context)); continue;
        }
        rules[name] = { ...rule, required: previous?.required === true || rule.required === true,
          ...(group === 'variables' ? { secret: previous?.secret === true || (rule as VariableRequirement).secret === true } : {}) } as VariableRequirement & BindingRequirement;
      }
    }
  }
  for (const [name, rule] of Object.entries(active.variables)) {
    variableTypes[name] = rule.type;
    let value: unknown;
    try { value = Object.hasOwn(envBindings, name) ? envBindings[name] : undefined; }
    catch { diagnostics.push(diagnostic('COSSACK_CONFIG_VALUE_UNREADABLE', 'variable', name, 'cannot be read safely', context)); continue; }
    if (context.mode === 'declarations' && rule.secret) {
      unverifiedSecrets.add(name);
      // Declaration names do not establish remote secret existence or values.
      if (value === undefined || value === null || value === '') continue;
    }
    const missing = value === undefined || value === null || value === '';
    if (missing) {
      if (rule.required) diagnostics.push(diagnostic('COSSACK_CONFIG_REQUIRED_MISSING', 'variable', name, 'is required but absent', context));
      continue;
    }
    const parsed = parseVariable(value, rule);
    if (parsed === undefined) diagnostics.push(diagnostic('COSSACK_CONFIG_VARIABLE_INVALID', 'variable', name, `must be a ${rule.type}${rule.coerce ? ' using the documented coercion rules' : ''}`, context));
    else variables[name] = parsed;
  }
  for (const [name, rule] of Object.entries(active.bindings)) {
    let value: unknown;
    try { value = context.mode === 'declarations' ? context.bindingKinds && Object.hasOwn(context.bindingKinds, name) ? context.bindingKinds[name] : undefined : Object.hasOwn(envBindings, name) ? envBindings[name] : undefined; }
    catch { diagnostics.push(diagnostic('COSSACK_CONFIG_VALUE_UNREADABLE', 'binding', name, 'cannot be read safely', context)); continue; }
    if ((value === undefined || value === null) && !rule.required) continue;
    if (rule.kind !== 'object' && context.runtime !== 'cloudflare') {
      diagnostics.push(diagnostic('COSSACK_CONFIG_RUNTIME_UNSUPPORTED', 'binding', name, `requires Cloudflare for binding kind ${rule.kind}`, context)); continue;
    }
    if (value === undefined || value === null) {
      diagnostics.push(diagnostic('COSSACK_CONFIG_REQUIRED_MISSING', 'binding', name, 'is required but absent', context)); continue;
    }
    try {
      const valid = context.mode === 'declarations' ? rule.kind === 'object' || value === rule.kind : matchesBinding(value, rule.kind);
      if (!valid) diagnostics.push(diagnostic('COSSACK_CONFIG_BINDING_INVALID', 'binding', name, `must match binding kind ${rule.kind}`, context));
    } catch { diagnostics.push(diagnostic('COSSACK_CONFIG_BINDING_INVALID', 'binding', name, 'cannot be validated safely', context)); }
  }
  return { variables, variableTypes, diagnostics, unverifiedSecrets: [...unverifiedSecrets].sort() };
}
