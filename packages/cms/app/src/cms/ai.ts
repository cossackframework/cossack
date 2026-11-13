/**
 * The application's AI provider for the CMS: Anthropic when `ANTHROPIC_API_KEY` is set, else the
 * Workers AI binding `AI` when the Worker has one, else none. `ANTHROPIC_MODEL` and
 * `WORKERS_AI_MODEL` pick the model.
 */
import { checkAiRequest, type AiProvider, type AiRequest } from '@cossackframework/cms/server';

export interface AiBindings {
    /** An Anthropic API key; `ANTHROPIC_MODEL` picks the model (default claude-sonnet-5-5). */
    ANTHROPIC_API_KEY?: string;
    ANTHROPIC_MODEL?: string;
    /** Anthropic's API base, for tests. */
    ANTHROPIC_API_URL?: string;
    /** Cloudflare Workers AI; `WORKERS_AI_MODEL` picks the model. */
    AI?: { run(model: string, input: unknown): Promise<unknown> };
    WORKERS_AI_MODEL?: string;
}

export function aiProvider(env: AiBindings, fetcher: typeof fetch = globalThis.fetch): AiProvider | null {
    const key = env.ANTHROPIC_API_KEY?.trim();
    if (key) return anthropic(key, env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5-5', env.ANTHROPIC_API_URL?.replace(/\/$/, '') || 'https://api.anthropic.com', fetcher);
    if (env.AI && typeof env.AI.run === 'function') return workersAi(env.AI, env.WORKERS_AI_MODEL?.trim() || '@cf/meta/llama-3.1-8b-instruct');
    return null;
}

/** Anthropic's Messages API. */
export function anthropic(key: string, model: string, api: string, fetcher: typeof fetch): AiProvider {
    return {
        name: 'anthropic',
        async complete(input: AiRequest) {
            const request = checkAiRequest(input);
            const response = await fetcher(`${api}/v1/messages`, {
                method: 'POST', signal: request.signal ?? null,
                headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
                body: JSON.stringify({ model, max_tokens: request.maxTokens, ...(request.system ? { system: request.system } : {}), messages: [{ role: 'user', content: request.prompt }] }),
            });
            if (!response.ok) throw new Error(`Anthropic answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
            const data = await response.json() as { content?: { type: string; text?: string }[] };
            return (data.content ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('').trim();
        },
    };
}

/** Cloudflare Workers AI through its binding. */
export function workersAi(binding: { run(model: string, input: unknown): Promise<unknown> }, model: string): AiProvider {
    return {
        name: 'workers-ai',
        async complete(input: AiRequest) {
            const request = checkAiRequest(input);
            const result = await binding.run(model, { max_tokens: request.maxTokens, messages: [...(request.system ? [{ role: 'system', content: request.system }] : []), { role: 'user', content: request.prompt }] }) as { response?: string } | string;
            return (typeof result === 'string' ? result : result?.response ?? '').trim();
        },
    };
}
