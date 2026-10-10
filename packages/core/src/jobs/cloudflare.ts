import type { JobAdapter, JobEnvelope } from './contracts';
/** Structural binding contract: portable core has no Cloudflare ambient dependency. */
export interface JobQueueBinding { send(body: JobEnvelope, options: { contentType: 'json'; delaySeconds: number }): Promise<unknown>; }
export function createCloudflareJobAdapter(binding: JobQueueBinding): JobAdapter {
    if (!binding || typeof binding.send !== 'function') throw new Error('[Cossack] A Cloudflare Queues producer binding is required.');
    return { durability: 'durable', async publish(envelope, options) { await binding.send(envelope, { contentType: 'json', delaySeconds: options.delaySeconds }); } };
}
