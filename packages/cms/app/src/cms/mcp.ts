/**
 * MCP (Model Context Protocol) over Streamable HTTP, stateless: each POST carries one JSON-RPC
 * message, or a batch, and gets its answers as JSON. There are no sessions and no
 * server-initiated streams, so GET and DELETE answer 405. The server speaks initialize, ping,
 * tools/list and tools/call, and acknowledges notifications with 202. It is the part of the
 * protocol the CMS needs, written here so applications take no SDK dependency; the official
 * client proves it in the CLI's tests.
 */

export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';

export interface JsonSchemaProperty {
    readonly type?: JsonSchemaType | readonly JsonSchemaType[];
    readonly description?: string;
    readonly enum?: readonly string[];
    readonly items?: JsonSchemaProperty;
    readonly properties?: { readonly [name: string]: JsonSchemaProperty };
    readonly additionalProperties?: boolean | JsonSchemaProperty;
    readonly minimum?: number;
    readonly maximum?: number;
    readonly default?: unknown;
}

export interface JsonSchema extends JsonSchemaProperty {
    readonly type: 'object';
    readonly properties: { readonly [name: string]: JsonSchemaProperty };
    readonly required?: readonly string[];
}

export interface McpToolAnnotations {
    readonly title?: string;
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
    readonly openWorldHint?: boolean;
}

export interface McpTool<C> {
    readonly name: string;
    readonly title?: string;
    readonly description: string;
    readonly inputSchema: JsonSchema;
    readonly annotations: McpToolAnnotations;
    run(input: { readonly [name: string]: unknown }, context: C): Promise<unknown>;
}

export interface McpServerOptions<C> {
    readonly name: string;
    readonly version: string;
    /** Guidance the client shows its model after initialize. */
    readonly instructions?: string;
    readonly tools: readonly McpTool<C>[];
    readonly context: C;
    /** The caller may only read: writing tools are neither listed nor run. */
    readonly readOnly?: boolean;
    /** Turns a tool's thrown error into the text and data of an `isError` result; others become "The tool failed." */
    readonly toolError?: (error: unknown) => { message: string; data?: unknown } | null;
}

/** Protocol revisions this server answers; a client's known revision is echoed, anything else gets the newest. */
export const MCP_PROTOCOL_VERSIONS: readonly string[] = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

type Id = string | number | null;
interface Message { jsonrpc?: unknown; id?: Id; method?: unknown; params?: unknown; result?: unknown; error?: unknown }

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function failure(id: Id, code: number, message: string, data?: unknown) {
    return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
}

export async function handleMcp<C>(request: Request, options: McpServerOptions<C>): Promise<Response> {
    if (request.method !== 'POST') {
        return json(failure(null, INVALID_REQUEST, request.method === 'GET' ? 'This server opens no streams: send JSON-RPC requests with POST.' : 'This server keeps no sessions.'), 405, { allow: 'POST' });
    }
    let parsed: unknown;
    try { parsed = await request.json(); }
    catch { return json(failure(null, PARSE_ERROR, 'The body is not JSON.'), 400); }
    const batch = Array.isArray(parsed);
    const messages = (batch ? parsed : [parsed]) as unknown[];
    if (!messages.length) return json(failure(null, INVALID_REQUEST, 'An empty batch.'), 400);
    const answers: unknown[] = [];
    for (const message of messages) {
        const reply = await handleMessage(message, options);
        if (reply !== undefined) answers.push(reply);
    }
    if (!answers.length) return new Response(null, { status: 202 });
    return json(batch ? answers : answers[0]);
}

async function handleMessage<C>(raw: unknown, options: McpServerOptions<C>): Promise<unknown> {
    const message = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Message : null;
    if (!message || message.jsonrpc !== '2.0') return failure(idOf(message), INVALID_REQUEST, 'Send JSON-RPC 2.0 messages.');
    // A client's response to a server request: this server sends none.
    if (message.method === undefined) return undefined;
    if (typeof message.method !== 'string') return failure(idOf(message), INVALID_REQUEST, 'method is a string.');
    const notification = message.id === undefined;
    const id = idOf(message);
    const params = message.params && typeof message.params === 'object' && !Array.isArray(message.params) ? message.params as { [name: string]: unknown } : {};
    if (notification) return undefined;
    switch (message.method) {
        case 'initialize': {
            const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
            return {
                jsonrpc: '2.0', id, result: {
                    protocolVersion: MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : MCP_PROTOCOL_VERSIONS[0],
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: options.name, version: options.version },
                    ...(options.instructions ? { instructions: options.instructions } : {}),
                },
            };
        }
        case 'ping': return { jsonrpc: '2.0', id, result: {} };
        case 'tools/list': return { jsonrpc: '2.0', id, result: { tools: listedTools(options).map(tool => ({
            name: tool.name, ...(tool.title ? { title: tool.title } : {}), description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations,
        })) } };
        case 'tools/call': return callTool(id, params, options);
        default: return failure(id, METHOD_NOT_FOUND, `Unknown method ${message.method}.`);
    }
}

function idOf(message: Message | null): Id {
    return message && (typeof message.id === 'string' || typeof message.id === 'number') ? message.id : null;
}

function listedTools<C>(options: McpServerOptions<C>): readonly McpTool<C>[] {
    return options.readOnly ? options.tools.filter(tool => tool.annotations.readOnlyHint) : options.tools;
}

async function callTool<C>(id: Id, params: { [name: string]: unknown }, options: McpServerOptions<C>): Promise<unknown> {
    const name = typeof params.name === 'string' ? params.name : '';
    const tool = options.tools.find(entry => entry.name === name);
    if (!tool) return failure(id, INVALID_PARAMS, `Unknown tool ${name || '(none)'}.`);
    if (options.readOnly && !tool.annotations.readOnlyHint) return failure(id, INVALID_PARAMS, 'This application password can only read.');
    const input = params.arguments === undefined ? {} : params.arguments;
    const problem = validateInput(tool.inputSchema, input);
    if (problem) return failure(id, INVALID_PARAMS, `Invalid arguments for ${name}: ${problem}`);
    try {
        const result = await tool.run(input as { [name: string]: unknown }, options.context);
        const structured = result === undefined ? { ok: true } : result;
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(structured) }], ...(structured && typeof structured === 'object' && !Array.isArray(structured) ? { structuredContent: structured } : {}), isError: false } };
    } catch (error) {
        const known = options.toolError?.(error) ?? null;
        if (!known) {
            console.error('[cms] an MCP tool failed', error);
            return failure(id, INTERNAL_ERROR, 'The tool failed.');
        }
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: known.message }], ...(known.data === undefined ? {} : { structuredContent: known.data }), isError: true } };
    }
}

/** Why the input does not fit the schema, or null. Checks presence, primitive types, enums and declared nested objects; the operations check values. */
export function validateInput(schema: JsonSchemaProperty, input: unknown, path = 'arguments'): string | null {
    if (schema.type === 'object' || schema.properties) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) return `${path} is an object.`;
        const record = input as { [name: string]: unknown };
        const properties = schema.properties ?? {};
        for (const name of (schema as JsonSchema).required ?? []) {
            if (record[name] === undefined) return `${name} is required.`;
        }
        for (const [name, value] of Object.entries(record)) {
            if (value === undefined) continue;
            const property = properties[name];
            if (!property) {
                if (schema.additionalProperties === false) return `${name} is not an argument.`;
                if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
                    const problem = validateInput(schema.additionalProperties, value, `${path}.${name}`);
                    if (problem) return problem;
                }
                continue;
            }
            const problem = validateInput(property, value, name);
            if (problem) return problem;
        }
        return null;
    }
    const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
    if (types.length && !types.some(type => matches(type, input))) return `${path} is ${types.map(article).join(' or ')}.`;
    if (schema.enum && !schema.enum.includes(input as string)) return `${path} is one of ${schema.enum.join(', ')}.`;
    if (typeof input === 'number') {
        if (schema.minimum !== undefined && input < schema.minimum) return `${path} is at least ${schema.minimum}.`;
        if (schema.maximum !== undefined && input > schema.maximum) return `${path} is at most ${schema.maximum}.`;
    }
    if (Array.isArray(input) && schema.items) {
        for (const [index, item] of input.entries()) {
            const problem = validateInput(schema.items, item, `${path}[${index}]`);
            if (problem) return problem;
        }
    }
    return null;
}

function matches(type: JsonSchemaType, value: unknown): boolean {
    switch (type) {
        case 'string': return typeof value === 'string';
        case 'number': return typeof value === 'number' && Number.isFinite(value);
        case 'integer': return typeof value === 'number' && Number.isInteger(value);
        case 'boolean': return typeof value === 'boolean';
        case 'array': return Array.isArray(value);
        case 'object': return !!value && typeof value === 'object' && !Array.isArray(value);
    }
}

function article(type: JsonSchemaType): string {
    return type === 'integer' || type === 'object' || type === 'array' ? `an ${type}` : `a ${type}`;
}
