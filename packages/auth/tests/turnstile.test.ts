import { describe, expect, it, vi } from 'vitest';
import { createTurnstileVerifier, TurnstileConfigurationError } from '../src/turnstile';
import { validateObject } from '../../core/src/shared/validation';
const options = { secret: 'PRIVATE_SECRET', expectedHostname: 'forms.example.test', expectedAction: 'submit' };
const ok = () => Response.json({ success: true, hostname: options.expectedHostname, action: options.expectedAction });
const fetcher = (fn: (...args: any[]) => any) => vi.fn(fn) as unknown as typeof fetch;

describe('server Turnstile verification', () => {
  it.each([undefined, null, ''])('rejects missing token %s before fetching', async token => {
    const request = fetcher(ok);
    expect(await createTurnstileVerifier({ ...options, fetch: request }).verify({ token })).toMatchObject({ success: false, code: 'COSSACK_TURNSTILE_TOKEN_MISSING' });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([false, { success: true }, 'x'.repeat(2049), 'bad token', 'bad\ntoken'])('rejects invalid token before fetching', async token => {
    const request = fetcher(ok);
    expect(await createTurnstileVerifier({ ...options, fetch: request }).verify({ token })).toMatchObject({ success: false, code: 'COSSACK_TURNSTILE_TOKEN_INVALID' });
    expect(request).not.toHaveBeenCalled();
  });
  it('verifies using server context and forwards only token and trusted remote IP', async () => {
    const request = fetcher(ok); const verifier = createTurnstileVerifier({ ...options, fetch: request });
    expect(await verifier.verify({ token: 'PRIVATE_TOKEN', remoteIP: '127.0.0.1' })).toEqual({ success: true });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(request).mock.calls[0]!;
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' } });
    expect(JSON.parse(init!.body as string)).toMatchObject({ secret: options.secret, response: 'PRIVATE_TOKEN', remoteip: '127.0.0.1', idempotency_key: expect.any(String) });
  });
  it.each([
    { success: false, 'error-codes': ['invalid-input-response'] },
    { success: false, 'error-codes': ['timeout-or-duplicate'] },
    { success: true, hostname: 'attacker.test', action: 'submit' },
    { success: true, hostname: options.expectedHostname, action: 'another-action' },
    { success: true },
  ])('blocks protected mutations after provider rejection or wrong context', async payload => {
    let mutations = 0;
    const verifier = createTurnstileVerifier({ ...options, fetch: fetcher(() => Response.json(payload)) });
    // A forged client success flag never replaces Siteverify.
    const submission = { token: 'PRIVATE_TOKEN', success: true };
    const result = await verifier.verify(submission);
    if (result.success) mutations++;
    expect(mutations).toBe(0); expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  });
  it('blocks missing tokens and repeat use before protected mutations', async () => {
    let calls = 0; let mutations = 0;
    const verifier = createTurnstileVerifier({ ...options, fetch: fetcher(() => calls++ === 0 ? ok() : Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] })) });
    for (const token of [undefined, 'single-token', 'single-token']) {
      const result = await verifier.verify({ token }); if (result.success) mutations++;
    }
    expect(mutations).toBe(1); expect(calls).toBe(2);
  });
  it.each(['PRIVATE_RAW_BODY', JSON.stringify({ success: 'true' }), JSON.stringify({ success: false, 'error-codes': 'PRIVATE_ERROR' }), 'x'.repeat(16385)])('fails closed on malformed or oversized responses', async body => {
    const result = await createTurnstileVerifier({ ...options, fetch: fetcher(() => new Response(body)) }).verify({ token: 'PRIVATE_TOKEN' });
    expect(result).toEqual({ success: false, code: 'COSSACK_TURNSTILE_RESPONSE_INVALID', retryable: false });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  });
  it('redacts network failures and uses no automatic retries by default', async () => {
    const request = fetcher(() => { throw Error('PRIVATE_SECRET PRIVATE_TOKEN'); });
    const result = await createTurnstileVerifier({ ...options, fetch: request }).verify({ token: 'PRIVATE_TOKEN' });
    expect(result).toEqual({ success: false, code: 'COSSACK_TURNSTILE_UNAVAILABLE', retryable: true });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('bounds transient retries and reuses only the Siteverify idempotency key', async () => {
    let calls = 0;
    const request = fetcher(() => calls++ === 0 ? new Response('PRIVATE_ERROR', { status: 503 }) : ok());
    expect(await createTurnstileVerifier({ ...options, retries: 2, fetch: request }).verify({ token: 'PRIVATE_TOKEN' })).toEqual({ success: true });
    const keys = vi.mocked(request).mock.calls.map(([, init]) => JSON.parse(init!.body as string).idempotency_key);
    expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
    const failed = fetcher(() => Response.json({ success: false, 'error-codes': ['internal-error'] }));
    expect(await createTurnstileVerifier({ ...options, retries: 2, fetch: failed }).verify({ token: 'PRIVATE_TOKEN' })).toMatchObject({ success: false });
    expect(failed).toHaveBeenCalledTimes(3);
    const duplicate = fetcher(() => Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] }));
    await createTurnstileVerifier({ ...options, retries: 2, fetch: duplicate }).verify({ token: 'PRIVATE_TOKEN' });
    expect(duplicate).toHaveBeenCalledTimes(1);
  });
  it('enforces deadlines even when injected fetch ignores abort', async () => {
    const request = fetcher(() => new Promise(() => {}));
    expect(await createTurnstileVerifier({ ...options, timeoutMs: 5, retries: 2, fetch: request }).verify({ token: 'PRIVATE_TOKEN' })).toEqual({ success: false, code: 'COSSACK_TURNSTILE_TIMEOUT', retryable: true });
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.mocked(request).mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });
  it('bounds stalled response reads and cancels the stream', async () => {
    const cancel = vi.fn();
    const request = fetcher(() => new Response(new ReadableStream({ cancel })));
    expect(await createTurnstileVerifier({ ...options, timeoutMs: 5, fetch: request }).verify({ token: 'PRIVATE_TOKEN' })).toMatchObject({ success: false, code: 'COSSACK_TURNSTILE_TIMEOUT' });
    expect(cancel).toHaveBeenCalled();
  });
  it('returns fixed configuration errors without values', () => {
    expect(() => createTurnstileVerifier({ ...options, expectedAction: 'PRIVATE_INVALID_ACTION_TOO_LONG'.repeat(4) })).toThrow(TurnstileConfigurationError);
    expect(() => createTurnstileVerifier({ ...options, timeoutMs: Infinity })).toThrow('Turnstile server configuration is invalid.');
  });
});


it('composes server field validation and Siteverify before the protected mutation', async () => {
  let mutations = 0;
  const request = fetcher(() => Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] }));
  const verifier = createTurnstileVerifier({ ...options, fetch: request });
  async function submit(message: string, token: unknown) {
    const checked = await validateObject({ message }, { message: { required: true, maxLength: 30 } });
    if (!checked.valid) return;
    const verified = await verifier.verify({ token });
    if (!verified.success) return;
    mutations++;
  }
  await submit('', 'PRIVATE_TOKEN');
  expect(request).not.toHaveBeenCalled();
  await submit('valid message', undefined);
  await submit('valid message', 'expired-or-reused-token');
  expect(mutations).toBe(0); expect(request).toHaveBeenCalledTimes(1);
  vi.mocked(request).mockImplementation(async () => ok());
  await submit('valid message', 'fresh-token');
  expect(mutations).toBe(1);
});
