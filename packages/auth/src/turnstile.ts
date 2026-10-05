const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const RESPONSE_LIMIT = 16 * 1024;
export type TurnstileFailureCode = 'COSSACK_TURNSTILE_TOKEN_MISSING' | 'COSSACK_TURNSTILE_TOKEN_INVALID'
  | 'COSSACK_TURNSTILE_REJECTED' | 'COSSACK_TURNSTILE_EXPIRED_OR_REUSED' | 'COSSACK_TURNSTILE_CONTEXT_MISMATCH'
  | 'COSSACK_TURNSTILE_UNAVAILABLE' | 'COSSACK_TURNSTILE_RESPONSE_INVALID' | 'COSSACK_TURNSTILE_TIMEOUT';
export type TurnstileVerification = Readonly<{ success: true }> | Readonly<{ success: false; code: TurnstileFailureCode; retryable: boolean }>;
export interface TurnstileVerifierOptions {
  secret: string;
  expectedHostname: string;
  expectedAction: string;
  fetch?: typeof globalThis.fetch;
  /** Overall deadline, including body reads and retries; 1–15000 ms. */
  timeoutMs?: number;
  /** Additional attempts after transient failures; 0–2. */
  retries?: number;
}
export interface TurnstileVerificationInput { token: unknown; remoteIP?: string }
export interface TurnstileVerifier { verify(input: TurnstileVerificationInput): Promise<TurnstileVerification> }
export class TurnstileConfigurationError extends Error {
  readonly code = 'COSSACK_TURNSTILE_CONFIG_INVALID';
  constructor() { super('Turnstile server configuration is invalid.'); this.name = 'TurnstileConfigurationError'; }
}
function failure(code: TurnstileFailureCode, retryable = false): TurnstileVerification {
  return Object.freeze({ success: false, code, retryable });
}
/** Server-only verification. Never authorize from a widget event or a client-supplied success flag. */
export function createTurnstileVerifier(options: TurnstileVerifierOptions): TurnstileVerifier {
  const { secret, expectedHostname, expectedAction } = options;
  const timeoutMs = options.timeoutMs ?? 5000;
  const retries = options.retries ?? 0;
  const request = options.fetch ?? globalThis.fetch;
  if (typeof secret !== 'string' || !secret.length || secret.length > 4096 || /\s/.test(secret)
    || typeof expectedHostname !== 'string' || !/^[a-zA-Z0-9.-]{1,253}$/.test(expectedHostname)
    || typeof expectedAction !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(expectedAction)
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000
    || !Number.isInteger(retries) || retries < 0 || retries > 2 || typeof request !== 'function') {
    throw new TurnstileConfigurationError();
  }
  return Object.freeze({ async verify(input: TurnstileVerificationInput): Promise<TurnstileVerification> {
    const token = input?.token;
    if (token === undefined || token === null || token === '') return failure('COSSACK_TURNSTILE_TOKEN_MISSING');
    if (typeof token !== 'string' || token.length > 2048 || !/^[\x21-\x7e]+$/.test(token)) return failure('COSSACK_TURNSTILE_TOKEN_INVALID');
    if (input.remoteIP !== undefined && (typeof input.remoteIP !== 'string' || !/^[a-fA-F0-9:.]{1,64}$/.test(input.remoteIP))) return failure('COSSACK_TURNSTILE_TOKEN_INVALID');
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<TurnstileVerification>(resolve => {
      timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => {}); resolve(failure('COSSACK_TURNSTILE_TIMEOUT', true)); }, timeoutMs);
    });
    const operation = async (): Promise<TurnstileVerification> => {
      // This key concerns Siteverify retries, not application mutation idempotency.
      const key = globalThis.crypto.randomUUID();
      for (let attempt = 0; attempt <= retries; attempt++) {
        let result: TurnstileVerification;
        try {
          const response = await request(SITEVERIFY, { method: 'POST', redirect: 'error', signal: controller.signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ secret, response: token, idempotency_key: key, ...(input.remoteIP ? { remoteip: input.remoteIP } : {}) }) });
          if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); return failure('COSSACK_TURNSTILE_TIMEOUT', true); }
          if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            result = failure('COSSACK_TURNSTILE_UNAVAILABLE', response.status >= 500 || response.status === 429);
          } else {
            if (!response.body) return failure('COSSACK_TURNSTILE_RESPONSE_INVALID');
            reader = response.body.getReader();
            const chunks: Uint8Array[] = []; let size = 0;
            while (true) {
              const chunk = await reader.read(); if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > RESPONSE_LIMIT || chunks.length >= 1024) { void reader.cancel().catch(() => {}); return failure('COSSACK_TURNSTILE_RESPONSE_INVALID'); }
              chunks.push(chunk.value);
            }
            reader.releaseLock(); reader = undefined;
            const bytes = new Uint8Array(size); let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            let payload: unknown;
            try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
            catch { return failure('COSSACK_TURNSTILE_RESPONSE_INVALID'); }
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return failure('COSSACK_TURNSTILE_RESPONSE_INVALID');
            const data = payload as Record<string, unknown>;
            if (typeof data.success !== 'boolean') return failure('COSSACK_TURNSTILE_RESPONSE_INVALID');
            if (data.success) {
              if (data.hostname !== expectedHostname || data.action !== expectedAction) return failure('COSSACK_TURNSTILE_CONTEXT_MISMATCH');
              return Object.freeze({ success: true });
            }
            const codes = data['error-codes'];
            if (!Array.isArray(codes) || !codes.every(code => typeof code === 'string')) return failure('COSSACK_TURNSTILE_RESPONSE_INVALID');
            result = codes.includes('timeout-or-duplicate') ? failure('COSSACK_TURNSTILE_EXPIRED_OR_REUSED')
              : codes.includes('internal-error') ? failure('COSSACK_TURNSTILE_UNAVAILABLE', true) : failure('COSSACK_TURNSTILE_REJECTED');
          }
        } catch { result = failure('COSSACK_TURNSTILE_UNAVAILABLE', true); }
        if (controller.signal.aborted) return failure('COSSACK_TURNSTILE_TIMEOUT', true);
        if (result.success || !result.retryable || attempt === retries) return result;
      }
      return failure('COSSACK_TURNSTILE_UNAVAILABLE', true);
    };
    try { return await Promise.race([operation().catch(() => failure('COSSACK_TURNSTILE_UNAVAILABLE', true)), timeout]); }
    finally { clearTimeout(timer); controller.abort(); void reader?.cancel().catch(() => {}); }
  } });
}
