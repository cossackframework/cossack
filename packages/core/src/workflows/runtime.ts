import { WorkflowError, type WorkflowDefinition, type WorkflowEvents, type WorkflowIdentity, type WorkflowEnvelope, type WorkflowProvider, type WorkflowScope, type WorkflowDriver, type WorkflowInspection, type WorkflowValue } from './contracts';
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function label(value: unknown): asserts value is string { if (typeof value !== 'string' || !identifier.test(value)) throw new WorkflowError('WORKFLOW_IDENTITY_INVALID'); }
/** Strict data-only JSON; never invokes authored getters, toJSON or array methods. */
export function workflowData(value: unknown): unknown {
    const seen = new Set<object>(); let nodes = 0;
    function visit(item: unknown, depth: number): unknown {
        if (++nodes > 10000 || depth > 32) throw new WorkflowError('WORKFLOW_INPUT_INVALID');
        if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return item;
        if (!item || typeof item !== 'object' || seen.has(item)) throw new WorkflowError('WORKFLOW_INPUT_INVALID');
        seen.add(item); const descriptors = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(item);
        try {
            if (Array.isArray(item)) {
                if (Object.getPrototypeOf(item) !== Array.prototype || keys.length !== item.length + 1) throw new WorkflowError('WORKFLOW_INPUT_INVALID');
                const result: unknown[] = [];
                for (let i = 0; i < item.length; i++) { const d = descriptors[String(i)]; if (!d || !d.enumerable || !('value' in d)) throw new WorkflowError('WORKFLOW_INPUT_INVALID'); result.push(visit(d.value, depth + 1)); }
                return result;
            }
            if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new WorkflowError('WORKFLOW_INPUT_INVALID');
            const result: Record<string, unknown> = {};
            for (const key of keys) { if (typeof key !== 'string') throw new WorkflowError('WORKFLOW_INPUT_INVALID'); const d = descriptors[key]!; if (!d.enumerable || !('value' in d)) throw new WorkflowError('WORKFLOW_INPUT_INVALID'); if (d.value !== undefined) Object.defineProperty(result, key, { value: visit(d.value, depth + 1), enumerable: true, configurable: true, writable: true }); }
            return result;
        } finally { seen.delete(item); }
    }
    const result = visit(value, 0); if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 128 * 1024) throw new WorkflowError('WORKFLOW_INPUT_INVALID'); return result;
}
export function defineWorkflow<T, E extends WorkflowEvents, Env = unknown>(definition: WorkflowDefinition<T, E, Env>): WorkflowDefinition<T, E, Env> {
    label(definition.name); if (!Number.isSafeInteger(definition.version) || definition.version < 1) throw new WorkflowError('WORKFLOW_IDENTITY_INVALID');
    for (const event of Object.keys(definition.events)) label(event);
    return Object.freeze({ ...definition, events: Object.freeze({ ...definition.events }) });
}
async function workflowId(namespace: string, name: string, version: number, scope: WorkflowScope, key: string): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify([namespace, name, version, scope.tenantId ?? null, scope.actorId ?? null, key]));
    const digest = await crypto.subtle.digest('SHA-256', bytes); return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
/** Identities are self-verifying: `id` must equal the digest of (namespace, name, version, scope, key), so a caller cannot rewrite `scope` (or any other field) without changing the instance it addresses. */
export async function validateWorkflowIdentity(identity: WorkflowIdentity, definition: { name: string; version: number }, namespace?: string): Promise<WorkflowIdentity> {
    const safe = workflowData(identity) as WorkflowIdentity; label(safe.namespace); label(safe.name); label(safe.key);
    if (!/^[a-f0-9]{64}$/.test(safe.id) || safe.name !== definition.name || safe.version !== definition.version || namespace !== undefined && safe.namespace !== namespace) throw new WorkflowError('WORKFLOW_IDENTITY_INVALID');
    if (!safe.scope || typeof safe.scope !== 'object' || Array.isArray(safe.scope) || Object.keys(safe).some(key => !['id', 'namespace', 'name', 'version', 'key', 'scope'].includes(key)) || Object.keys(safe.scope).some(key => !['tenantId', 'actorId'].includes(key))) throw new WorkflowError('WORKFLOW_IDENTITY_INVALID');
    if (safe.scope.tenantId !== undefined) label(safe.scope.tenantId); if (safe.scope.actorId !== undefined) label(safe.scope.actorId);
    if (await workflowId(safe.namespace, safe.name, safe.version, safe.scope, safe.key) !== safe.id) throw new WorkflowError('WORKFLOW_IDENTITY_INVALID');
    return Object.freeze({ ...safe, scope: Object.freeze({ ...safe.scope }) });
}
async function parsed<T>(schema: { parse(value: unknown): Promise<T> }, input: unknown, event = false): Promise<T> {
    try { return workflowData(await schema.parse(workflowData(input))) as T; } catch { throw new WorkflowError(event ? 'WORKFLOW_EVENT_INVALID' : 'WORKFLOW_INPUT_INVALID'); }
}
function stepName(name: string) { if (typeof name !== 'string' || !name || name.length > 256 || /[\x00-\x1f]/.test(name)) throw new WorkflowError('WORKFLOW_INPUT_INVALID'); }
function duration(ms: number, zero = false) { if (!Number.isSafeInteger(ms) || ms < (zero ? 0 : 1)) throw new WorkflowError('WORKFLOW_INPUT_INVALID'); }
function stepOptions(options: import('./contracts').WorkflowStepOptions | undefined) {
    if (!options) return undefined;
    const safe = workflowData(options) as import('./contracts').WorkflowStepOptions;
    if (safe.timeout !== undefined) duration(safe.timeout);
    if (safe.retries) { if (!Number.isSafeInteger(safe.retries.limit) || safe.retries.limit < 0 || safe.retries.limit > 100) throw new WorkflowError('WORKFLOW_INPUT_INVALID'); duration(safe.retries.delay, true); if (safe.retries.backoff !== undefined && !['constant', 'linear', 'exponential'].includes(safe.retries.backoff)) throw new WorkflowError('WORKFLOW_INPUT_INVALID'); }
    return safe;
}
export async function executeWorkflow<T, E extends WorkflowEvents, Env>(definition: WorkflowDefinition<T, E, Env>, envelope: WorkflowEnvelope, driver: WorkflowDriver, env: Env): Promise<unknown> {
    envelope = workflowData(envelope) as WorkflowEnvelope;
    if (envelope.format !== 1) throw new WorkflowError('WORKFLOW_IDENTITY_INVALID'); const identity = await validateWorkflowIdentity(envelope.identity, definition);
    const input = await parsed(definition.schema, envelope.payload);
    return workflowData(await definition.run(input, { identity, env, step: {
        do: (name, callback, options) => { stepName(name); return driver.do(name, async () => workflowData(await callback()) as Awaited<ReturnType<typeof callback>>, stepOptions(options)); },
        sleep: (name, ms) => { stepName(name); duration(ms); return driver.sleep(name, ms); },
        waitForEvent: async (name, type, options) => { stepName(name); if (options?.timeout !== undefined) duration(options.timeout); if (!Object.hasOwn(definition.events, type)) throw new WorkflowError('WORKFLOW_EVENT_INVALID'); return parsed(definition.events[type]!, await driver.waitForEvent(name, type, options), true); },
    } }));
}
export function createWorkflowClient<T, E extends WorkflowEvents, Env>(definition: WorkflowDefinition<T, E, Env>, provider: WorkflowProvider, options: { namespace: string; authorize?: (operation: 'invoke' | 'inspect' | 'event' | 'pause' | 'resume' | 'terminate', identity: WorkflowIdentity) => void | Promise<void> }) {
    label(options.namespace);
    async function authorize(operation: Parameters<NonNullable<typeof options.authorize>>[0], identity: WorkflowIdentity) { const safe = await validateWorkflowIdentity(identity, definition, options.namespace); await options.authorize?.(operation, safe); return safe; }
    return {
        async invoke(input: T, invocation: { key: string; scope?: WorkflowScope }): Promise<WorkflowIdentity> {
            label(invocation.key); const scope = workflowData(invocation.scope ?? {}) as WorkflowScope; if (Object.keys(scope).some(key => !['tenantId', 'actorId'].includes(key))) throw new WorkflowError('WORKFLOW_IDENTITY_INVALID'); if (scope.tenantId !== undefined) label(scope.tenantId); if (scope.actorId !== undefined) label(scope.actorId);
            const id = await workflowId(options.namespace, definition.name, definition.version, scope, invocation.key);
            const identity = Object.freeze({ id, namespace: options.namespace, name: definition.name, version: definition.version, key: invocation.key, scope: Object.freeze(scope) });
            await authorize('invoke', identity); const payload = await parsed(definition.schema, input); await provider.create({ format: 1, identity, payload }); return identity;
        },
        async inspect(identity: WorkflowIdentity): Promise<WorkflowInspection> { identity = await authorize('inspect', identity); const status = await provider.inspect(identity.id); return { identity, durability: provider.durability, status, ...(status === 'failed' ? { code: 'WORKFLOW_FAILED' as const } : {}) }; },
        async sendEvent<K extends keyof E & string>(identity: WorkflowIdentity, type: K, payload: WorkflowValue<E[K]>): Promise<void> { identity = await authorize('event', identity); if (!Object.hasOwn(definition.events, type)) throw new WorkflowError('WORKFLOW_EVENT_INVALID'); await provider.sendEvent(identity.id, type, await parsed(definition.events[type]!, payload, true)); },
        async pause(identity: WorkflowIdentity) { identity = await authorize('pause', identity); await provider.control(identity.id, 'pause'); },
        async resume(identity: WorkflowIdentity) { identity = await authorize('resume', identity); await provider.control(identity.id, 'resume'); },
        async terminate(identity: WorkflowIdentity) { identity = await authorize('terminate', identity); await provider.control(identity.id, 'terminate'); },
    };
}
