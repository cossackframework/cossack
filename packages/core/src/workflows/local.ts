import { WorkflowError, type WorkflowDefinition, type WorkflowEvents, type WorkflowEnvelope, type WorkflowProvider, type WorkflowStatus, type WorkflowData, type WorkflowStepOptions } from './contracts';
import { executeWorkflow } from './runtime';
function interruption() { return new WorkflowError('WORKFLOW_TERMINATED'); }
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const abort = () => { signal.removeEventListener('abort', abort); reject(interruption()); };
        if (signal.aborted) { operation.catch(() => {}); reject(interruption()); return; }
        signal.addEventListener('abort', abort, { once: true });
        operation.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    });
}
function timer(ms: number, signal: AbortSignal): Promise<void> {
    if (!Number.isSafeInteger(ms) || ms < 0 || ms > 2147483647) return Promise.reject(new WorkflowError('WORKFLOW_INPUT_INVALID'));
    return new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(handle); signal.removeEventListener('abort', abort); reject(interruption()); };
        const handle = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
        if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    });
}
/** Process-only deterministic test adapter. No restart recovery or provider durability. */
export function createLocalWorkflowProvider<T, E extends WorkflowEvents, Env>(definition: WorkflowDefinition<T, E, Env>, options: { env: Env; sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void> }): WorkflowProvider {
    interface Instance { status: WorkflowStatus; events: Map<string, unknown[]>; waiters: Map<string, (value: unknown) => void>; controller: AbortController; wake?: () => void; previous?: WorkflowStatus; }
    const instances = new Map<string, Instance>();
    const get = (id: string) => { const instance = instances.get(id); if (!instance) throw new WorkflowError('WORKFLOW_PROVIDER_UNAVAILABLE'); return instance; };
    async function ready(instance: Instance) { while (instance.status === 'paused') await new Promise<void>(resolve => { instance.wake = resolve; }); if (instance.controller.signal.aborted) throw interruption(); }
    const sleep = (ms: number, signal: AbortSignal) => abortable(options.sleep ? options.sleep(ms, signal) : timer(ms, signal), signal);
    function stop(instance: Instance) { instance.controller.abort(); instance.wake?.(); for (const waiter of instance.waiters.values()) waiter(undefined); instance.waiters.clear(); }
    async function perform<R>(instance: Instance, callback: () => Promise<R>, timeout?: number): Promise<R> {
        const operation = abortable(Promise.resolve().then(callback), instance.controller.signal);
        if (timeout === undefined) return operation;
        const clock = new AbortController(); const abort = () => clock.abort(); instance.controller.signal.addEventListener('abort', abort, { once: true });
        const deadline = timer(timeout, clock.signal).then(() => { throw new WorkflowError('WORKFLOW_PROVIDER_UNAVAILABLE'); });
        try { return await Promise.race([operation, deadline]); }
        finally { clock.abort(); instance.controller.signal.removeEventListener('abort', abort); }
    }
    return {
        durability: 'process',
        async create(envelope: WorkflowEnvelope) {
            if (instances.has(envelope.identity.id)) throw new WorkflowError('WORKFLOW_DUPLICATE');
            const instance: Instance = { status: 'queued', events: new Map(), waiters: new Map(), controller: new AbortController() }; instances.set(envelope.identity.id, instance);
            void Promise.resolve().then(async () => {
                await ready(instance); instance.status = 'running';
                await executeWorkflow(definition, envelope, {
                    async do<R extends WorkflowData>(_name: string, callback: () => Promise<R>, config?: WorkflowStepOptions) {
                        await ready(instance); const limit = config?.retries?.limit ?? 0;
                        for (let attempt = 0; ; attempt++) {
                            try { const value = await perform(instance, callback, config?.timeout); await ready(instance); return value; }
                            catch (error) {
                                if (instance.controller.signal.aborted || attempt >= limit) throw error;
                                const factor = config?.retries?.backoff === 'linear' ? attempt + 1 : config?.retries?.backoff === 'exponential' ? 2 ** attempt : 1;
                                await sleep((config?.retries?.delay ?? 0) * factor, instance.controller.signal); await ready(instance);
                            }
                        }
                    },
                    async sleep(_name, ms) { await ready(instance); instance.status = 'waiting'; await sleep(ms, instance.controller.signal); await ready(instance); instance.status = 'running'; },
                    async waitForEvent(_name, type, config) {
                        await ready(instance); const queue = instance.events.get(type); if (queue?.length) return queue.shift();
                        if (instance.waiters.has(type)) throw new WorkflowError('WORKFLOW_EVENT_INVALID');
                        instance.status = 'waiting'; const clock = new AbortController(); const abort = () => clock.abort(); instance.controller.signal.addEventListener('abort', abort, { once: true });
                        const event = new Promise<unknown>(resolve => { instance.waiters.set(type, resolve); });
                        const deadline = config?.timeout === undefined ? undefined : timer(config.timeout, clock.signal).then(() => { throw new WorkflowError('WORKFLOW_EVENT_INVALID'); });
                        try { const value = await abortable(deadline ? Promise.race([event, deadline]) : event, instance.controller.signal); await ready(instance); instance.status = 'running'; return value; }
                        finally { clock.abort(); instance.controller.signal.removeEventListener('abort', abort); instance.waiters.delete(type); }
                    },
                }, options.env);
                await ready(instance); instance.status = 'complete'; stop(instance);
            }).catch(() => { if (instance.status !== 'terminated') instance.status = 'failed'; stop(instance); });
        },
        async inspect(id) { return get(id).status; },
        async sendEvent(id, type, payload) { const instance = get(id); if (['failed', 'complete', 'terminated'].includes(instance.status)) throw new WorkflowError('WORKFLOW_EVENT_INVALID'); const waiter = instance.waiters.get(type); if (waiter) { instance.waiters.delete(type); waiter(payload); } else { const queue = instance.events.get(type) ?? []; if (queue.length >= 100) throw new WorkflowError('WORKFLOW_EVENT_INVALID'); queue.push(payload); instance.events.set(type, queue); } },
        async control(id, action) {
            const instance = get(id); if (['failed', 'complete', 'terminated'].includes(instance.status)) throw new WorkflowError('WORKFLOW_PROVIDER_UNAVAILABLE');
            if (action === 'pause') { if (instance.status === 'paused') throw new WorkflowError('WORKFLOW_PROVIDER_UNAVAILABLE'); instance.previous = instance.status; instance.status = 'paused'; }
            else if (action === 'resume') { if (instance.status !== 'paused') throw new WorkflowError('WORKFLOW_PROVIDER_UNAVAILABLE'); instance.status = instance.previous ?? 'running'; instance.wake?.(); }
            else { instance.status = 'terminated'; stop(instance); }
        },
    };
}
