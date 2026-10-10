import { WorkflowError, type WorkflowEnvelope, type WorkflowProvider, type WorkflowStatus } from '@cossackframework/core/workflows';
export interface CloudflareWorkflowBinding {
    create(options: { id: string; params: WorkflowEnvelope }): Promise<unknown>;
    get(id: string): Promise<CloudflareWorkflowInstance>;
}
export interface CloudflareWorkflowInstance {
    status(): Promise<{ status: string }>;
    sendEvent(event: { type: string; payload: unknown }): Promise<void>;
    pause(): Promise<void>; resume(): Promise<void>; terminate(): Promise<void>;
}
export function createCloudflareWorkflowProvider(binding: CloudflareWorkflowBinding): WorkflowProvider {
    const unavailable = () => new WorkflowError('WORKFLOW_PROVIDER_UNAVAILABLE');
    // `get()` rejects for unknown instance ids. Local workerd accepts a create() for an
    // existing id, so duplicates are rejected here instead of relying on the runtime.
    const exists = async (id: string) => { try { await (await binding.get(id)).status(); return true; } catch { return false; } };
    return {
        durability: 'durable',
        async create(envelope) {
            const id = envelope.identity.id;
            if (await exists(id)) throw new WorkflowError('WORKFLOW_DUPLICATE');
            try { await binding.create({ id, params: envelope }); }
            catch { throw (await exists(id)) ? new WorkflowError('WORKFLOW_DUPLICATE') : unavailable(); }
        },
        async inspect(id) { try { const { status } = await (await binding.get(id)).status(); const states: Record<string, WorkflowStatus> = { queued: 'queued', running: 'running', paused: 'paused', waitingForPause: 'paused', waiting: 'waiting', complete: 'complete', errored: 'failed', terminated: 'terminated', unknown: 'unknown' }; return Object.hasOwn(states, status) ? states[status]! : 'unknown'; } catch { throw unavailable(); } },
        async sendEvent(id, type, payload) { try { await (await binding.get(id)).sendEvent({ type, payload }); } catch { throw unavailable(); } },
        async control(id, action) { try { await (await binding.get(id))[action](); } catch { throw unavailable(); } },
    };
}
