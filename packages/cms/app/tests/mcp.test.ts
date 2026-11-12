import { describe, expect, it } from 'vitest';
import { handleMcp, MCP_MAX_BATCH, MCP_MAX_BYTES, MCP_PROTOCOL_VERSIONS, validateInput, type McpTool } from '../src/cms/mcp';

type Ctx = { calls: string[] };
const tools: McpTool<Ctx>[] = [
    { name: 'read_thing', description: 'Reads.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, count: { type: 'integer', minimum: 1 } }, required: ['id'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        async run(input, ctx) { ctx.calls.push(`read ${input.id}`); return { id: input.id, found: true }; } },
    { name: 'write_thing', description: 'Writes.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['a', 'b'] } }, required: ['id'] }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        async run(input, ctx) { ctx.calls.push(`write ${input.id}`); if (input.id === 'refused') throw new Refusal('Not allowed to write this.'); if (input.id === 'crash') throw new Error('secret detail'); return undefined; } },
];
class Refusal extends Error {}
const post = (body: unknown, options: Partial<Parameters<typeof handleMcp<Ctx>>[1]> = {}, ctx: Ctx = { calls: [] }) =>
    handleMcp(new Request('http://cms.test/api/cms/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }),
        { name: 'cossack-cms', version: '1', instructions: 'Be nice.', tools, context: ctx, toolError: error => error instanceof Refusal ? { message: error.message, data: { code: 'REFUSED' } } : null, ...options });
const rpc = (method: string, params?: unknown, id: number | string = 1) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });

describe('MCP over stateless Streamable HTTP', () => {
    it('initializes with the client\'s known protocol revision, or the newest', async () => {
        const known = await (await post(rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } }))).json();
        expect(known).toEqual({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'cossack-cms', version: '1' }, instructions: 'Be nice.' } });
        const unknown = await (await post(rpc('initialize', { protocolVersion: '2031-01-01' }))).json();
        expect(unknown.result.protocolVersion).toBe(MCP_PROTOCOL_VERSIONS[0]);
    });

    it('refuses a body over the limit and a batch over the limit, running nothing', async () => {
        const ctx: Ctx = { calls: [] };
        const big = await post(rpc('tools/call', { name: 'write_thing', arguments: { id: 'x'.repeat(MCP_MAX_BYTES) } }), {}, ctx);
        expect(big.status).toBe(413);
        expect((await big.json()).error.code).toBe(-32600);
        // A chunked body with no declared length is counted as it is read.
        const stream = new ReadableStream<Uint8Array>({ start(controller) {
            const chunk = new TextEncoder().encode(' '.repeat(64 * 1024));
            for (let i = 0; i < 20; i++) controller.enqueue(chunk);
            controller.close();
        } });
        const chunked = await handleMcp(new Request('http://cms.test/api/cms/mcp', { method: 'POST', body: stream, duplex: 'half' } as RequestInit), { name: 'cossack-cms', version: '1', tools, context: ctx });
        expect(chunked.status).toBe(413);
        const many = Array.from({ length: MCP_MAX_BATCH + 1 }, (_, i) => rpc('tools/call', { name: 'write_thing', arguments: { id: `w${i}` } }, i));
        const batch = await post(many, {}, ctx);
        expect(batch.status).toBe(400);
        expect((await batch.json()).error.message).toContain(String(MCP_MAX_BATCH));
        expect(ctx.calls).toEqual([]);
        expect((await (await post(many.slice(0, MCP_MAX_BATCH), {}, ctx)).json())).toHaveLength(MCP_MAX_BATCH);
    });

    it('acknowledges notifications with 202 and answers ping', async () => {
        const response = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
        expect(response.status).toBe(202);
        expect(await response.text()).toBe('');
        expect(await (await post(rpc('ping'))).json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    });

    it('lists tools with their schemas and annotations, reading tools only for a read-only caller', async () => {
        const all = await (await post(rpc('tools/list'))).json();
        expect(all.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['read_thing', 'write_thing']);
        expect(all.result.tools[0]).toMatchObject({ description: 'Reads.', inputSchema: { type: 'object', required: ['id'] }, annotations: { readOnlyHint: true } });
        const reading = await (await post(rpc('tools/list'), { readOnly: true })).json();
        expect(reading.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['read_thing']);
        const refused = await (await post(rpc('tools/call', { name: 'write_thing', arguments: { id: 'x' } }), { readOnly: true })).json();
        expect(refused.error).toMatchObject({ code: -32602, message: 'This application password can only read.' });
    });

    it('runs a tool and returns its result as text and structured content', async () => {
        const ctx: Ctx = { calls: [] };
        const response = await post(rpc('tools/call', { name: 'read_thing', arguments: { id: 'p1', count: 2 } }, 'abc'), {}, ctx);
        expect(response.headers.get('content-type')).toBe('application/json');
        expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 'abc', result: { content: [{ type: 'text', text: '{"id":"p1","found":true}' }], structuredContent: { id: 'p1', found: true }, isError: false } });
        expect(ctx.calls).toEqual(['read p1']);
        const empty = await (await post(rpc('tools/call', { name: 'write_thing', arguments: { id: 'w1' } }))).json();
        expect(empty.result).toEqual({ content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true }, isError: false });
    });

    it('rejects invalid arguments before running the tool', async () => {
        const ctx: Ctx = { calls: [] };
        const cases: [unknown, string][] = [
            [{}, 'id is required.'], [{ id: 1 }, 'id is a string.'], [{ id: 'a', count: 0 }, 'count is at least 1.'],
            [{ id: 'a', count: 1.5 }, 'count is an integer.'], [{ id: 'a', extra: true }, 'extra is not an argument.'], ['no', 'arguments is an object.'],
        ];
        for (const [args, problem] of cases) {
            const answer = await (await post(rpc('tools/call', { name: 'read_thing', arguments: args }), {}, ctx)).json();
            expect(answer.error, JSON.stringify(args)).toEqual({ code: -32602, message: `Invalid arguments for read_thing: ${problem}` });
        }
        const enumerated = await (await post(rpc('tools/call', { name: 'write_thing', arguments: { id: 'a', kind: 'c' } }), {}, ctx)).json();
        expect(enumerated.error.message).toBe('Invalid arguments for write_thing: kind is one of a, b.');
        expect(ctx.calls).toEqual([]);
        const unknown = await (await post(rpc('tools/call', { name: 'nope', arguments: {} }))).json();
        expect(unknown.error).toEqual({ code: -32602, message: 'Unknown tool nope.' });
    });

    it('turns a known refusal into an error result and hides other failures', async () => {
        const refused = await (await post(rpc('tools/call', { name: 'write_thing', arguments: { id: 'refused' } }))).json();
        expect(refused.result).toEqual({ content: [{ type: 'text', text: 'Not allowed to write this.' }], structuredContent: { code: 'REFUSED' }, isError: true });
        const crashed = await (await post(rpc('tools/call', { name: 'write_thing', arguments: { id: 'crash' } }))).json();
        expect(crashed.error).toEqual({ code: -32603, message: 'The tool failed.' });
        expect(JSON.stringify(crashed)).not.toContain('secret detail');
    });

    it('answers protocol mistakes: bad JSON, wrong version, unknown methods, batches, other verbs', async () => {
        expect(await (await post('{not json')).json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'The body is not JSON.' } });
        expect((await post({ id: 1, method: 'ping' })).status).toBe(200);
        expect(await (await post({ id: 1, method: 'ping' })).json()).toMatchObject({ error: { code: -32600 } });
        expect(await (await post(rpc('resources/list'))).json()).toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Unknown method resources/list.' } });
        const batch = await (await post([rpc('ping', undefined, 1), { jsonrpc: '2.0', method: 'notifications/initialized' }, rpc('ping', undefined, 2)])).json();
        expect(batch).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }, { jsonrpc: '2.0', id: 2, result: {} }]);
        expect((await post([])).status).toBe(400);
        for (const method of ['GET', 'DELETE']) {
            const response = await handleMcp(new Request('http://cms.test/api/cms/mcp', { method }), { name: 'x', version: '1', tools, context: { calls: [] } });
            expect(response.status).toBe(405);
            expect(response.headers.get('allow')).toBe('POST');
        }
    });

    it('validates nested objects and arrays', () => {
        const schema = { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } }, meta: { type: 'object', properties: { n: { type: 'number' } } } } } as const;
        expect(validateInput(schema, { tags: ['a'], meta: { n: 1, other: true } })).toBeNull();
        expect(validateInput(schema, { tags: ['a', 2] })).toBe('tags[1] is a string.');
        expect(validateInput(schema, { meta: { n: 'x' } })).toBe('n is a number.');
        expect(validateInput(schema, { meta: [] })).toBe('meta is an object.');
    });
});
