import { WorkflowEntrypoint, type WorkflowStep as NativeStep, type WorkflowEvent } from 'cloudflare:workers';
import { executeWorkflow, workflowData, WorkflowError, type WorkflowDefinition, type WorkflowEnvelope, type WorkflowEvents, type WorkflowDriver, type WorkflowData, type WorkflowStepOptions } from '@cossackframework/core/workflows';
export * from './provider';
/** Explicit native entry: import only in a Cloudflare Worker export graph. */
export interface CloudflareWorkflowClass<Env> { new(ctx: ExecutionContext, env: Env): WorkflowEntrypoint<Env, WorkflowEnvelope>; }
export function createCloudflareWorkflow<T, E extends WorkflowEvents, Env>(definition: WorkflowDefinition<T, E, Env>): CloudflareWorkflowClass<Env> {
    return class CossackWorkflow extends WorkflowEntrypoint<Env, WorkflowEnvelope> {
        override async run(event: WorkflowEvent<WorkflowEnvelope>, native: NativeStep): Promise<unknown> {
            if (event.instanceId !== event.payload.identity.id) throw new WorkflowError('WORKFLOW_IDENTITY_INVALID');
            const driver: WorkflowDriver = {
                do: <R extends WorkflowData>(name: string, callback: () => Promise<R>, options?: WorkflowStepOptions) => {
                    // Strict data-only JSON is a subset of native Rpc.Serializable;
                    // the native conditional generic cannot infer that for arbitrary R.
                    const checked = async () => workflowData(await callback());
                    type JsonNativeDo = (name: string, config: WorkflowStepOptions, callback: () => Promise<unknown>) => Promise<unknown>;
                    return (native as unknown as { do: JsonNativeDo }).do(name, options ?? {}, checked) as Promise<R>;
                },
                sleep: (name, ms) => native.sleep(name, ms),
                waitForEvent: async (name, type, options) => (await native.waitForEvent(name, { type, ...options })).payload,
            };
            return executeWorkflow(definition, event.payload, driver, this.env);
        }
    };
}
