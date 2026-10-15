import { RpcError } from '@cossackframework/core';
import type { Context } from 'hono';
import { parseBody } from 'hono/utils/body';
import { declaredLengthExceeds, readBoundedBody } from '../request-body.js';

const BODY_KEY = 'cossack:rpc-request';
const invalid = (path: string): never => { throw new RpcError('COSSACK_RPC_REQUEST_INVALID', `Invalid RPC request at ${path}.`); };

/** Default `/crpc` JSON request limit (matches `defineApi`'s `maxBodyBytes`). */
export const RPC_JSON_REQUEST_MAX_BYTES = 1024 * 1024;
/** Default `/upload` multipart request limit, files included. */
export const RPC_UPLOAD_REQUEST_MAX_BYTES = 32 * 1024 * 1024;

export interface RpcBodyLimits {
    /** Maximum `/crpc` JSON body bytes. Default: 1 MiB. */
    jsonBytes?: number;
    /** Maximum `/upload` (multipart or form) body bytes, files included. Default: 32 MiB. */
    uploadBytes?: number;
}

const tooLarge = () => new RpcError('COSSACK_RPC_REQUEST_TOO_LARGE', 'RPC request body is too large.', { status: 413 });

async function readBody(c: Context, limit: number): Promise<Uint8Array<ArrayBuffer>> {
    const body = c.req.raw.body;
    if (declaredLengthExceeds(c.req.raw.headers, limit)) {
        void body?.cancel().catch(() => {});
        throw tooLarge();
    }
    return body ? readBoundedBody(body, limit, tooLarge) : new Uint8Array();
}

/** Decode once for both transport guards and the shared action dispatcher. */
export async function readRpcRequest(c: Context, limits: RpcBodyLimits = {}): Promise<Record<string, any>> {
    const cached = c.get(BODY_KEY);
    if (cached) return cached;
    let body: any;
    if (c.req.path === '/upload' || c.req.header('Content-Type')?.startsWith('multipart/form-data')) {
        // Buffer at most the limit, then parse the bounded copy (never the raw stream).
        const bytes = await readBody(c, limits.uploadBytes ?? RPC_UPLOAD_REQUEST_MAX_BYTES);
        const headers = new Headers(c.req.raw.headers);
        headers.delete('Content-Length');
        const fields = await parseBody(new Request(c.req.url, { method: 'POST', headers, body: bytes }), { all: true });
        body = Object.create(null);
        for (const key of ['componentRouteId', 'pageRouteId', 'action', 'target', 'scopeKey']) {
            if (fields[key] !== undefined) {
                if (typeof fields[key] !== 'string') invalid(key);
                body[key] = fields[key];
            }
        }
        for (const key of ['state', 'payload', 'service', 'pageParams']) {
            if (fields[key] !== undefined) {
                if (typeof fields[key] !== 'string') invalid(key);
                try { body[key] = JSON.parse(fields[key] as string); } catch { invalid(key); }
            }
        }
        if (body.payload === undefined) body.payload = [];
        const restore = (value: any, path: string, depth: number): any => {
            if (depth > 256) invalid(path);
            if (value === null || typeof value !== 'object') return value;
            if (Object.hasOwn(value, '_cossack_file_id')) {
                const id = value._cossack_file_id;
                if (Object.keys(value).length !== 1 || typeof id !== 'string' || !/^file_[0-9]+$/.test(id)) invalid(path);
                const file = fields[id];
                if (!(file instanceof File)) invalid(path);
                return file;
            }
            if (Array.isArray(value)) return value.map((item, index) => restore(item, `${path}[${index}]`, depth + 1));
            const result = Object.create(null);
            for (const key of Object.keys(value)) result[key] = restore(value[key], `${path}.${key}`, depth + 1);
            return result;
        };
        body.payload = restore(body.payload, 'payload', 0);
    } else {
        const bytes = await readBody(c, limits.jsonBytes ?? RPC_JSON_REQUEST_MAX_BYTES);
        body = JSON.parse(new TextDecoder().decode(bytes));
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('(root)');
    for (const key of ['componentRouteId', 'pageRouteId', 'action', 'target', 'scopeKey']) {
        if (body[key] !== undefined && (typeof body[key] !== 'string' || !body[key].trim())) invalid(key);
    }
    if (body.payload !== undefined && !Array.isArray(body.payload)) invalid('payload');
    for (const key of ['state', 'service', 'pageParams']) {
        if (body[key] !== undefined && (!body[key] || typeof body[key] !== 'object' || Array.isArray(body[key]))) invalid(key);
    }
    c.set(BODY_KEY, body);
    return body;
}
