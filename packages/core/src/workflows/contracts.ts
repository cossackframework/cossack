export interface WorkflowSchema<T> { parse(value: unknown): Promise<T>; }
export type WorkflowEvents = Record<string, WorkflowSchema<any>>;
export type WorkflowValue<S> = S extends WorkflowSchema<infer T> ? T : never;
export type WorkflowData = null | boolean | number | string | WorkflowData[] | { [key: string]: WorkflowData };
export interface WorkflowScope { tenantId?: string; actorId?: string; }
/** Self-verifying handle: `id` is SHA-256 of (namespace, name, version, scope, key) and is recomputed on every use, so `scope` can be trusted by `authorize`. */
export interface WorkflowIdentity { readonly id: string; readonly namespace: string; readonly name: string; readonly version: number; readonly key: string; readonly scope: Readonly<WorkflowScope>; }
export interface WorkflowStepOptions { retries?: { limit: number; delay: number; backoff?: 'constant' | 'linear' | 'exponential' }; timeout?: number; }
/** The provider owns persistence/replay. A retried side effect needs an application receipt/idempotency key. */
export interface WorkflowStep<E extends WorkflowEvents> {
    do<T extends WorkflowData>(name: string, callback: () => T | Promise<T>, options?: WorkflowStepOptions): Promise<T>;
    sleep(name: string, milliseconds: number): Promise<void>;
    waitForEvent<K extends keyof E & string>(name: string, type: K, options?: { timeout?: number }): Promise<WorkflowValue<E[K]>>;
}
export interface WorkflowContext<E extends WorkflowEvents, Env> { readonly identity: WorkflowIdentity; readonly env: Env; readonly step: WorkflowStep<E>; }
export interface WorkflowDefinition<T, E extends WorkflowEvents, Env = unknown> {
    readonly name: string; readonly version: number; readonly schema: WorkflowSchema<T>; readonly events: E;
    run(input: T, context: WorkflowContext<E, Env>): WorkflowData | Promise<WorkflowData>;
}
export type WorkflowStatus = 'queued' | 'running' | 'paused' | 'waiting' | 'complete' | 'failed' | 'terminated' | 'unknown';
export interface WorkflowInspection { readonly identity: WorkflowIdentity; readonly durability: 'process' | 'durable'; readonly status: WorkflowStatus; readonly code?: 'WORKFLOW_FAILED' | 'WORKFLOW_PROVIDER_UNAVAILABLE'; }
export interface WorkflowEnvelope { readonly format: 1; readonly identity: WorkflowIdentity; readonly payload: unknown; }
export interface WorkflowProvider {
    readonly durability: 'process' | 'durable';
    create(envelope: WorkflowEnvelope): Promise<void>;
    inspect(id: string): Promise<WorkflowStatus>;
    sendEvent(id: string, type: string, payload: unknown): Promise<void>;
    control(id: string, action: 'pause' | 'resume' | 'terminate'): Promise<void>;
}
export interface WorkflowDriver {
    do<T extends WorkflowData>(name: string, callback: () => Promise<T>, options?: WorkflowStepOptions): Promise<T>;
    sleep(name: string, milliseconds: number): Promise<void>;
    waitForEvent(name: string, type: string, options?: { timeout?: number }): Promise<unknown>;
}
export class WorkflowError extends Error {
    constructor(readonly code: 'WORKFLOW_INPUT_INVALID' | 'WORKFLOW_EVENT_INVALID' | 'WORKFLOW_IDENTITY_INVALID' | 'WORKFLOW_PROVIDER_UNAVAILABLE' | 'WORKFLOW_DUPLICATE' | 'WORKFLOW_TERMINATED') { super('The workflow operation could not be completed.'); this.name = 'WorkflowError'; }
}
