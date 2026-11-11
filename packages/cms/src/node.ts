import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import { privateAddress } from './webhooks';

/** A name or address that leads to this machine or a private network. */
export class PrivateAddressError extends Error {
    constructor(host: string) {
        super(`${host} is this machine or a private network.`);
        this.name = 'PrivateAddressError';
    }
}

/**
 * A `fetch` for webhook deliveries on Node that refuses to connect to this machine or a private
 * network. The check runs on the addresses the connection itself uses, so a name that resolves
 * to a private address, or changes to one after the webhook was saved, is refused too. It sends
 * a string body, never follows redirects, and honours `signal`.
 */
export const publicOnlyFetch: typeof globalThis.fetch = (input, init = {}) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const signal = init.signal ?? request?.signal ?? undefined;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return Promise.reject(new TypeError(`Unsupported protocol ${url.protocol}`));
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && privateAddress(host)) return Promise.reject(new PrivateAddressError(host));
    const headers = new Headers(init.headers ?? request?.headers);
    const body = init.body ?? null;
    if (body !== null && typeof body !== 'string') return Promise.reject(new TypeError('publicOnlyFetch sends string bodies only.'));
    if (body !== null) headers.set('content-length', String(Buffer.byteLength(body)));
    const lookup: LookupFunction = (hostname, options, callback) => {
        dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
            if (error) return callback(error, '', 0);
            const list = addresses as unknown as LookupAddress[];
            if (!list.length || list.some(entry => privateAddress(entry.address))) return callback(new PrivateAddressError(hostname), '', 0);
            if ((options as { all?: boolean }).all) return (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, list);
            callback(null, list[0]!.address, list[0]!.family);
        });
    };
    return new Promise<Response>((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        const send = url.protocol === 'https:' ? https.request : http.request;
        const outgoing = send(url, { method: init.method ?? request?.method ?? 'GET', headers: Object.fromEntries(headers), lookup }, incoming => {
            const status = incoming.statusCode ?? 0;
            if (status < 200 || status > 599) {
                incoming.resume();
                return reject(new TypeError(`The receiver answered with status ${status}.`));
            }
            const responseHeaders = new Headers();
            for (const [name, value] of Object.entries(incoming.headers)) {
                if (value === undefined) continue;
                for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(name, item);
            }
            const empty = status === 204 || status === 205 || status === 304 || init.method === 'HEAD';
            if (empty) incoming.resume();
            resolve(new Response(empty ? null : Readable.toWeb(incoming) as ReadableStream, { status, headers: responseHeaders }));
        });
        const abort = () => outgoing.destroy(signal!.reason instanceof Error ? signal!.reason : new Error('aborted'));
        signal?.addEventListener('abort', abort, { once: true });
        outgoing.on('error', error => reject(signal?.aborted ? signal.reason : error));
        outgoing.on('close', () => signal?.removeEventListener('abort', abort));
        outgoing.end(body ?? undefined);
    });
};
