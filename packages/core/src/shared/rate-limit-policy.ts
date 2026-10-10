const encoder = /* @__PURE__ */ new TextEncoder();

export function assertRateLimitKey(key: unknown): asserts key is string {
    if (typeof key !== 'string' || !key.trim() || encoder.encode(key).length > 512 ||
        new TextDecoder().decode(encoder.encode(key)) !== key) {
        throw new Error('[Cossack] Rate-limit key must be a nonempty valid UTF-8 string of at most 512 bytes.');
    }
}

export function rateLimitNamespace(value: unknown): asserts value is string {
    if (typeof value !== 'string' || encoder.encode(value).length > 512 || new TextDecoder().decode(encoder.encode(value)) !== value) {
        throw new Error('[Cossack] Rate-limit namespace must be a string of at most 512 UTF-8 bytes.');
    }
}

export function rateLimitStorageKey(namespace: string, key: string): string {
    const framed = JSON.stringify([namespace, key]);
    if (encoder.encode(framed).length > 512) throw new Error('[Cossack] Rate-limit namespace and key exceed 512 UTF-8 bytes.');
    return framed;
}

export function redisEndpoint(value: unknown): string {
    try {
        if (typeof value !== 'string' || !value.startsWith('https://') || /[\\\u0000-\u0020\u007f]/.test(value) || encoder.encode(value).length > 2048) throw new Error();
        const url = new URL(value);
        if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || value.includes('?') || value.includes('#') ||
            encoder.encode(url.href).length > 2048) throw new Error();
        return url.href;
    } catch {
        throw new Error('[Cossack] Redis endpoint must be an HTTPS URL without embedded credentials, query or fragment, at most 2048 UTF-8 bytes.');
    }
}

export function redisToken(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value || value.length > 8192 || /[\u0000-\u0020\u007f-\uffff]/.test(value)) {
        throw new Error('[Cossack] Redis token must be a nonempty ASCII bearer token of at most 8192 bytes without whitespace or controls.');
    }
}
