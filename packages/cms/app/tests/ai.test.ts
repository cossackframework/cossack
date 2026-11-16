import { describe, expect, it } from 'vitest';
import { aiProvider, anthropic, workersAi } from '../src/cms/ai';

describe('the AI provider', () => {
    it('picks Anthropic, then Workers AI, else none', () => {
        expect(aiProvider({})).toBeNull();
        expect(aiProvider({ ANTHROPIC_API_KEY: 'k' })?.name).toBe('anthropic');
        expect(aiProvider({ AI: { run: async () => ({ response: '' }) } })?.name).toBe('workers-ai');
    });

    it('calls the Messages API and reads the text back', async () => {
        const calls: { url: string; init: RequestInit }[] = [];
        const provider = anthropic('sk-ant', 'claude-sonnet-5-5', 'https://anthropic.test', (async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), init: init! });
            return Response.json({ content: [{ type: 'text', text: ' A short excerpt. ' }] });
        }) as typeof fetch);
        expect(await provider.complete({ system: 'Be brief.', prompt: 'Summarize this.', maxTokens: 99_999 })).toBe('A short excerpt.');
        expect(calls[0]!.url).toBe('https://anthropic.test/v1/messages');
        const headers = calls[0]!.init.headers as Record<string, string>;
        expect(headers['x-api-key']).toBe('sk-ant');
        expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ model: 'claude-sonnet-5-5', max_tokens: 4000, system: 'Be brief.', messages: [{ role: 'user', content: 'Summarize this.' }] });
        await expect(provider.complete({ prompt: '' })).rejects.toThrow(/empty/);
        const failing = anthropic('k', 'm', 'https://a.test', (async () => new Response('overloaded', { status: 529 })) as typeof fetch);
        await expect(failing.complete({ prompt: 'x' })).rejects.toThrow(/529/);
    });

    it('runs a Workers AI model through its binding', async () => {
        const seen: unknown[] = [];
        const provider = workersAi({ run: async (model, input) => { seen.push([model, input]); return { response: 'Answer.' }; } }, '@cf/meta/llama-3.1-8b-instruct');
        expect(await provider.complete({ prompt: 'Hi', system: 'Be nice.' })).toBe('Answer.');
        expect(seen[0]).toEqual(['@cf/meta/llama-3.1-8b-instruct', { max_tokens: 1000, messages: [{ role: 'system', content: 'Be nice.' }, { role: 'user', content: 'Hi' }] }]);
    });
});
