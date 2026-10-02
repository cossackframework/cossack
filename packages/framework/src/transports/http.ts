import { RpcError } from '@cossackframework/core';
import type { Context } from 'hono';

const BODY_KEY = 'cossack:rpc-request';
const invalid = (path: string): never => { throw new RpcError('COSSACK_RPC_REQUEST_INVALID', `Invalid RPC request at ${path}.`); };

/** Decode once for both transport guards and the shared action dispatcher. */
export async function readRpcRequest(c: Context): Promise<Record<string, any>> {
    const cached = c.get(BODY_KEY);
    if (cached) return cached;
    let body: any;
    if (c.req.path === '/upload' || c.req.header('Content-Type')?.startsWith('multipart/form-data')) {
        const fields = await c.req.parseBody({ all: true });
        body = Object.create(null);
        for (const key of ['componentRouteId', 'action', 'target', 'scopeKey']) {
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
        body = await c.req.json();
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('(root)');
    for (const key of ['componentRouteId', 'action', 'target', 'scopeKey']) {
        if (body[key] !== undefined && (typeof body[key] !== 'string' || !body[key].trim())) invalid(key);
    }
    if (body.payload !== undefined && !Array.isArray(body.payload)) invalid('payload');
    for (const key of ['state', 'service', 'pageParams']) {
        if (body[key] !== undefined && (!body[key] || typeof body[key] !== 'object' || Array.isArray(body[key]))) invalid(key);
    }
    c.set(BODY_KEY, body);
    return body;
}
