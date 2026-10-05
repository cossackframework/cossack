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
    return {
        durability: 'durable',
        async create(envelope) { try { await binding.create({ id: envelope.identity.id, params: envelope }); } catch { throw unavailable(); } },
        async inspect(id) { try { const { status } = await (await binding.get(id)).status(); const states: Record<string, WorkflowStatus> = { queued: 'queued', running: 'running', paused: 'paused', waitingForPause: 'paused', waiting: 'waiting', complete: 'complete', errored: 'failed', terminated: 'terminated', unknown: 'unknown' }; return Object.hasOwn(states, status) ? states[status]! : 'unknown'; } catch { throw unavailable(); } },
        async sendEvent(id, type, payload) { try { await (await binding.get(id)).sendEvent({ type, payload }); } catch { throw unavailable(); } },
        async control(id, action) { try { await (await binding.get(id))[action](); } catch { throw unavailable(); } },
    };
}
