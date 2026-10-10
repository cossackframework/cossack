import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWranglerPreviewProvider } from '../src/cloudflare-preview-provider.js';

const accountId = 'a'.repeat(32), token = 'PRIVATE_PROVIDER_TOKEN';
const repository = path.resolve(import.meta.dirname, '../../..');
const preview = { id: 'preview-id', name: 'pr-42', created_on: '2026-10-06T00:00:00.000Z', urls: ['https://pr-42.worker.example.workers.dev'], env: { PRIVATE_TOKEN: token } };
const deployment = { id: 'deployment-id', preview_id: 'preview-id', preview_name: 'pr-42', annotations: { 'workers/tag': 'cossack-owner-id' }, env: { PRIVATE_TOKEN: token } };
// Actual Wrangler 4.148 and scoped REST bodies omit preview_id/preview_name.
const nativeDeployment = { id: deployment.id, annotations: deployment.annotations, urls: preview.urls, env: deployment.env };
const folders = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(folders.splice(0).map(folder => fs.rm(folder, { recursive: true, force: true }))); });
const ok = value => ({ exitCode: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value) });
function fixture(options = {}) {
  const calls = [];
  const runner = options.runner ?? (async (args, context) => {
    calls.push({ args, context });
    if (args.includes('--help')) return ok('--name --worker-name --json --ignore-base-config --tag --skip-confirmation');
    if (args[0] === '--version') return ok('4.147.0');
    if (args[0] === 'whoami') return ok({ loggedIn: true, accounts: [{ id: accountId }] });
    if (args[1] === 'delete') return ok('Deleted');
    return ok({ preview, deployment });
  });
  return { calls, provider: createWranglerPreviewProvider(repository, { accountId, token, runner, ...options }) };
}
async function config(account = accountId) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-preview-provider-')); folders.push(directory);
  const filename = path.join(directory, 'wrangler.json');
  await fs.writeFile(filename, JSON.stringify({ account_id: account }));
  return filename;
}
const response = value => new Response(JSON.stringify({ success: true, result: value }));

describe('Wrangler preview provider transport', () => {
  it('normalizes actual field-absent native deployment output without losing immutable preview identity or tag', async () => {
    const { provider } = fixture({ runner: async args => args.includes('--help') ? ok('--name --worker-name --json --ignore-base-config --tag --skip-confirmation')
      : args[0] === '--version' ? ok('4.148.0') : args[0] === 'whoami' ? ok({ loggedIn: true, accounts: [{ id: accountId }] })
        : ok({ preview, deployment: nativeDeployment }) });
    await provider.verify();
    expect(await provider.deploy(await config(), 'worker', 'pr-42', 'cossack-owner-id')).toEqual({
      status: 'deployed', preview: { id: preview.id, name: preview.name, createdOn: preview.created_on },
      deployment: { id: deployment.id, tag: 'cossack-owner-id' }, url: preview.urls[0],
    });
  });
  it('accepts actual native asset progress followed by one trailing JSON envelope without exposing progress or bindings', async () => {
    const prefix = '🌀 Building list of assets...\n✨ Read 19 files from the assets directory /private/app/dist/client\n🌀 Starting asset upload...\nNo updated asset files to upload. Proceeding with deployment...\n';
    const output = prefix + JSON.stringify({ preview, deployment: nativeDeployment }, null, 2) + '\n';
    const { provider } = fixture({ runner: async args => args.includes('--help') ? ok('--name --worker-name --json --ignore-base-config --tag --skip-confirmation')
      : args[0] === '--version' ? ok('4.148.0') : args[0] === 'whoami' ? ok({ loggedIn: true, accounts: [{ id: accountId }] }) : ok(output) });
    await provider.verify();
    const result = await provider.deploy(await config(), 'worker', 'pr-42', 'cossack-owner-id');
    expect(result).toEqual({ status: 'deployed', preview: { id: preview.id, name: preview.name, createdOn: preview.created_on },
      deployment: { id: deployment.id, tag: 'cossack-owner-id' }, url: preview.urls[0] });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain('/private/app');
  });
  it.each([
    'progress\n' + JSON.stringify({ preview, deployment: nativeDeployment }) + '\ntrailing junk',
    'progress ' + JSON.stringify({ preview, deployment: nativeDeployment }),
    '{}\n' + JSON.stringify({ preview, deployment: nativeDeployment }),
    'progress\n[]\n' + JSON.stringify({ preview, deployment: nativeDeployment }),
    'progress\n{malformed\n' + JSON.stringify({ preview, deployment: nativeDeployment }),
    'progress\n' + JSON.stringify({ preview, deployment: nativeDeployment }) + '\n' + JSON.stringify({ preview, deployment: nativeDeployment }),
    'progress\n' + JSON.stringify({ preview, deployment: { ...nativeDeployment, annotations: { 'workers/tag': 'foreign' } } }),
  ])('rejects ambiguous, malformed, non-line-start, trailing or foreign-owner native envelopes', async output => {
    const { provider } = fixture({ runner: async args => args.includes('--help') ? ok('--name --worker-name --json --ignore-base-config --tag --skip-confirmation')
      : args[0] === '--version' ? ok('4.148.0') : args[0] === 'whoami' ? ok({ loggedIn: true, accounts: [{ id: accountId }] }) : ok(output) });
    await provider.verify();
    expect(await provider.deploy(await config(), 'worker', 'pr-42', 'cossack-owner-id'))
      .toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_OUTPUT_INVALID' });
  });
  it('recovers actual latest deployment shape only through independent immutable-ID scope and matching tag', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(response(nativeDeployment));
    const { provider } = fixture({ fetch: fetcher });
    expect((await provider.recoverDeployment('worker', 'pr-42', 'cossack-owner-id')).status).toBe('recovered');
    expect(fetcher.mock.calls[1][0]).toContain('/previews/preview-id/deployments/latest');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('inspects actual field-absent deployment shape with no invented preview scope fields or extra requests', async () => {
    const fetcher = vi.fn(async () => response(nativeDeployment));
    expect(await fixture({ fetch: fetcher }).provider.inspectDeployment('worker', preview.id, deployment.id)).toEqual({
      status: 'present', deployment: { id: deployment.id, tag: 'cossack-owner-id' },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain('/previews/preview-id/deployments/deployment-id');
  });
  it.each([null, undefined, [], 'malformed', 42, { preview_name: null }])('rejects malformed successful deployment REST payload without throwing', async result => {
    const fetcher = vi.fn(async () => response(result));
    expect(await fixture({ fetch: fetcher }).provider.inspectDeployment('worker', preview.id, deployment.id))
      .toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_OUTPUT_INVALID' });
  });
  it.each([
    { ...nativeDeployment, preview_id: 'foreign' }, { ...nativeDeployment, preview_name: 'foreign' },
    { ...nativeDeployment, preview_id: null }, { ...nativeDeployment, preview_name: null },
    { ...nativeDeployment, id: '' }, { ...nativeDeployment, annotations: {} },
    { ...nativeDeployment, annotations: { 'workers/tag': 'foreign-tag' } },
  ])('rejects explicit foreign scope, missing ownership or mismatched tag from native paired output', async bad => {
    const { provider } = fixture({ runner: async args => args.includes('--help') ? ok('--name --worker-name --json --ignore-base-config --tag --skip-confirmation')
      : args[0] === '--version' ? ok('4.148.0') : args[0] === 'whoami' ? ok({ loggedIn: true, accounts: [{ id: accountId }] })
        : ok({ preview, deployment: bad }) });
    await provider.verify();
    expect(await provider.deploy(await config(), 'worker', 'pr-42', 'cossack-owner-id')).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_OUTPUT_INVALID' });
  });
  it.each([
    response({ ...preview, id: 'foreign' }), response({ ...preview, name: 'foreign' }),
    new Response('', { status: 403 }), new Response('', { status: 404 }),
  ])('fails closed when explicit deployment name cannot be independently matched to immutable preview identity', async current => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(deployment)).mockResolvedValueOnce(current);
    expect((await fixture({ fetch: fetcher }).provider.inspectDeployment('worker', preview.id, deployment.id)).status).toBe('unknown');
    expect(fetcher.mock.calls[1][0]).toMatch(/\/previews\/preview-id$/);
  });
  it('isolates every native run in a fresh mode-700 private log directory and removes logs on success', async () => {
    const logPaths = [];
    const runner = async (args, context) => {
      const filename = context.env.WRANGLER_LOG_PATH;
      expect(path.basename(filename)).toBe('wrangler.log');
      if (process.platform !== 'win32') expect((await fs.stat(path.dirname(filename))).mode & 0o777).toBe(0o700);
      logPaths.push(filename);
      await fs.writeFile(filename, token);
      if (args.includes('--help')) return ok('--name --worker-name --json --ignore-defaults --tag --skip-confirmation');
      if (args[0] === '--version') return ok('4.147.0');
      return ok({ loggedIn: true, accounts: [{ id: accountId }] });
    };
    const result = await fixture({ runner }).provider.verify();
    expect(result).toEqual({ status: 'verified', accountId });
    expect(logPaths).toHaveLength(5);
    expect(new Set(logPaths).size).toBe(5);
    for (const filename of logPaths) await expect(fs.stat(path.dirname(filename))).rejects.toThrow();
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it.each(['failure', 'cancel', 'timeout'])('removes private native logs after %s without leaking their values', async mode => {
    let filename;
    const controller = new AbortController();
    const runner = async (_args, context) => {
      filename = context.env.WRANGLER_LOG_PATH;
      await fs.writeFile(filename, token);
      if (mode === 'failure') throw new Error(token);
      if (mode === 'cancel') controller.abort();
      return new Promise(() => {});
    };
    const result = await fixture({ runner, timeoutMs: 40 }).provider.verify({ signal: controller.signal });
    expect(result.status).toBe('unknown');
    expect(result.code).toBe(mode === 'failure' ? 'COSSACK_CF_PREVIEW_TRANSPORT_FAILED'
      : mode === 'cancel' ? 'COSSACK_CF_PREVIEW_CANCELLED' : 'COSSACK_CF_PREVIEW_TIMEOUT');
    await expect(fs.stat(path.dirname(filename))).rejects.toThrow();
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it('recovers a lost receipt only from independent native latest deployment ownership proof', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(response(deployment));
    const { provider, calls } = fixture({ fetch: fetcher });
    expect(await provider.recoverDeployment('worker', 'pr-42', 'cossack-owner-id')).toEqual({
      status: 'recovered', preview: { id: preview.id, name: preview.name, createdOn: preview.created_on },
      deployment: { id: deployment.id, tag: 'cossack-owner-id' }, url: preview.urls[0],
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/workers/worker/previews/pr-42`,
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/workers/worker/previews/preview-id/deployments/latest`,
    ]);
    expect(calls).toHaveLength(0); // Recovery never invokes mutation commands.
  });
  it('rejects a foreign latest deployment tag even when the preview name matches intent', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(response({ ...deployment, annotations: { 'workers/tag': 'foreign-owner' } }));
    expect(await fixture({ fetch: fetcher }).provider.recoverDeployment('worker', 'pr-42', 'cossack-owner-id'))
      .toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_OWNERSHIP_MISMATCH' });
  });
  it.each([{ ...deployment, preview_id: 'foreign-preview' }, { ...deployment, preview_name: 'foreign-name' }, { ...deployment, annotations: {} }])('rejects invalid latest deployment scope or missing tag during recovery', async latest => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(response(latest));
    expect(await fixture({ fetch: fetcher }).provider.recoverDeployment('worker', 'pr-42', 'cossack-owner-id'))
      .toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_OUTPUT_INVALID' });
  });
  it('does not infer recovery from unknown or absent independent provider reads', async () => {
    const first = vi.fn(async () => new Response('', { status: 404 }));
    expect(await fixture({ fetch: first }).provider.recoverDeployment('worker', 'pr-42', 'cossack-owner-id'))
      .toEqual({ status: 'absent', code: 'COSSACK_CF_PREVIEW_ABSENT' });
    expect(first).toHaveBeenCalledTimes(1);
    for (const [status, expected] of [[404, { status: 'absent', code: 'COSSACK_CF_PREVIEW_DEPLOYMENT_ABSENT', preview: { id: preview.id, name: preview.name, createdOn: preview.created_on } }], [403, { status: 'unknown', code: 'COSSACK_CF_PREVIEW_INSPECTION_FAILED' }]]) {
      const fetcher = vi.fn().mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(new Response(token, { status }));
      expect(await fixture({ fetch: fetcher }).provider.recoverDeployment('worker', 'pr-42', 'cossack-owner-id')).toEqual(expected);
    }
  });
  it('recovers identity without inventing a missing native URL', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ ...preview, urls: [] })).mockResolvedValueOnce(response(deployment));
    const result = await fixture({ fetch: fetcher }).provider.recoverDeployment('worker', 'pr-42', 'cossack-owner-id');
    expect(result.status).toBe('recovered');
    expect(result).not.toHaveProperty('url');
  });
  it('proves native command capabilities and target account before mutation', async () => {
    const { provider, calls } = fixture();
    expect(await provider.verify()).toEqual({ status: 'verified', accountId });
    expect(calls.map(call => call.args.slice(0, call.args.indexOf('--config')))).toEqual([
      ['--version'], ['preview', '--help'], ['preview', 'delete', '--help'], ['whoami', '--help'], ['whoami', '--json'],
    ]);
    for (const { context } of calls) {
      expect(context.env.CLOUDFLARE_API_TOKEN).toBe(token);
      expect(context.env.CLOUDFLARE_ACCOUNT_ID).toBe(accountId);
      expect(context.env.CLOUDFLARE_API_BASE_URL).toBe('https://api.cloudflare.com/client/v4');
      expect(context.env.CI).toBe('true');
      expect(context.signal).toBeInstanceOf(AbortSignal);
    }
    await expect(fs.stat(calls[0].args.at(-1))).rejects.toThrow();
  });
  it('uses exact native create flags and whitelists actual provider identities and URL', async () => {
    const { provider, calls } = fixture(); await provider.verify();
    const filename = await config();
    expect(await provider.deploy(filename, 'worker', 'pr-42', 'cossack-owner-id')).toEqual({
      status: 'deployed', preview: { id: 'preview-id', name: 'pr-42', createdOn: preview.created_on },
      deployment: { id: 'deployment-id', tag: 'cossack-owner-id' }, url: preview.urls[0],
    });
    expect(calls.at(-1).args).toEqual(['preview', '--name', 'pr-42', '--worker-name', 'worker', '--tag', 'cossack-owner-id', '--json', '--ignore-base-config', '--config', filename]);
  });
  it('uses native skip-confirmation delete after caller ownership verification', async () => {
    const { provider, calls } = fixture(); await provider.verify(); const filename = await config();
    expect(await provider.remove(filename, 'worker', preview.id)).toEqual({ status: 'removed' });
    expect(calls.at(-1).args).toEqual(['preview', 'delete', '--name', preview.id, '--worker-name', 'worker', '--skip-confirmation', '--config', filename]);
  });
  it('never mutates before account proof or with mismatching prepared config account', async () => {
    const { provider, calls } = fixture(); const filename = await config('b'.repeat(32));
    expect((await provider.deploy(filename, 'worker', 'pr-42', 'tag')).code).toBe('COSSACK_CF_PREVIEW_ACCOUNT_UNVERIFIED');
    expect(calls).toHaveLength(0);
    await provider.verify();
    expect((await provider.deploy(filename, 'worker', 'pr-42', 'tag')).code).toBe('COSSACK_CF_PREVIEW_ACCOUNT_MISMATCH');
    expect((await provider.remove(filename, 'worker', 'pr-42')).code).toBe('COSSACK_CF_PREVIEW_ACCOUNT_MISMATCH');
    expect(calls).toHaveLength(5);
  });
  it('reads exact account-scoped provider paths without following redirects or exposing auth', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(response(deployment)).mockResolvedValueOnce(response(preview));
    const { provider } = fixture({ fetch: fetcher });
    expect(await provider.inspect('worker', 'pr-42')).toEqual({ status: 'present', preview: { id: 'preview-id', name: 'pr-42', createdOn: preview.created_on } });
    expect(await provider.inspectDeployment('worker', 'preview-id', 'deployment-id')).toEqual({ status: 'present', deployment: { id: 'deployment-id', tag: 'cossack-owner-id' } });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/workers/worker/previews/pr-42`,
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/workers/worker/previews/preview-id/deployments/deployment-id`,
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/workers/worker/previews/preview-id`,
    ]);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error', headers: { authorization: 'Bearer ' + token } });
  });
  it('encodes a preview branch slash instead of changing the API path scope', async () => {
    const fetcher = vi.fn(async () => response({ ...preview, name: 'feature/42' }));
    const { provider } = fixture({ fetch: fetcher });
    expect((await provider.inspect('worker', 'feature/42')).status).toBe('present');
    expect(fetcher.mock.calls[0][0]).toContain('/previews/feature%2F42');
  });
  it('distinguishes real 404 absence from authorization and other failures', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(new Response(token, { status: 403 }));
    const { provider } = fixture({ fetch: fetcher });
    expect(await provider.inspect('worker', 'pr-42')).toEqual({ status: 'absent' });
    expect(await provider.inspect('worker', 'pr-42')).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_INSPECTION_FAILED' });
  });
  it.each([
    { ...preview, name: 'foreign-name' }, { ...preview, created_on: 'invalid' }, { ...preview, id: '\n' + token },
  ])('rejects invalid returned preview identity without reflecting data', async bad => {
    const result = await fixture({ fetch: async () => response(bad) }).provider.inspect('worker', 'pr-42');
    expect(result).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_OUTPUT_INVALID' });
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it.each([
    { ...deployment, preview_id: 'foreign-preview' }, { ...deployment, id: 'foreign-deployment' }, { ...deployment, annotations: {} },
  ])('rejects wrong deployment scope or absent ownership annotation', async bad => {
    expect(await fixture({ fetch: async () => response(bad) }).provider.inspectDeployment('worker', 'preview-id', 'deployment-id'))
      .toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_OUTPUT_INVALID' });
  });
  it.each(['banner\n{}', '{invalid', token])('marks successful but invalid native mutation output indeterminate', async output => {
    const { provider } = fixture({ runner: async args => args[0] === 'preview' && !args.includes('--help') && args[1] !== 'delete' ? ok(output)
      : args.includes('--help') ? ok('--name --worker-name --json --ignore-defaults --tag --skip-confirmation')
        : args[0] === '--version' ? ok('4.147.0') : ok({ loggedIn: true, accounts: [{ id: accountId }] }) });
    await provider.verify();
    expect(await provider.deploy(await config(), 'worker', 'pr-42', 'cossack-owner-id')).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_OUTPUT_INVALID' });
  });
  it.each(['http://preview.workers.dev', 'https://user:password@preview.workers.dev', 'https://127.0.0.1', 'https://preview.workers.dev/path', 'https://preview.workers.dev/?token=secret', 'https://foreign.example.com'])('rejects unsafe returned preview URLs', async url => {
    const runner = async args => args.includes('--help') ? ok('--name --worker-name --json --ignore-defaults --tag --skip-confirmation')
      : args[0] === '--version' ? ok('4.147.0') : args[0] === 'whoami' ? ok({ loggedIn: true, accounts: [{ id: accountId }] })
        : ok({ preview: { ...preview, urls: [url] }, deployment });
    const provider = fixture({ runner }).provider;
    await provider.verify();
    expect((await provider.deploy(await config(), 'worker', 'pr-42', 'cossack-owner-id')).status).toBe('unknown');
  });
  it('rejects missing credentials and malformed account or limits without reflecting input', async () => {
    vi.stubEnv('CLOUDFLARE_API_TOKEN', '');
    expect((await createWranglerPreviewProvider(repository, { accountId }).inspect('worker', 'pr-42')).code).toBe('COSSACK_CF_PREVIEW_AUTH_REQUIRED');
    expect(() => createWranglerPreviewProvider(repository, { accountId: token })).toThrow('COSSACK_CF_PREVIEW_ACCOUNT_INVALID');
    expect(() => createWranglerPreviewProvider(repository, { accountId, timeoutMs: 0 })).toThrow('COSSACK_CF_PREVIEW_LIMITS_INVALID');
  });
  it('fails closed on unsupported native command flags and account mismatch', async () => {
    expect((await fixture({ runner: async args => args[0] === '--version' ? ok('4.147.0') : ok('--json') }).provider.verify()).status).toBe('unsupported');
    const runner = async args => args.includes('--help') ? ok('--name --worker-name --json --ignore-defaults --tag --skip-confirmation')
      : args[0] === '--version' ? ok('4.147.0') : ok({ loggedIn: true, accounts: [{ id: 'b'.repeat(32) }] });
    expect((await fixture({ runner }).provider.verify()).code).toBe('COSSACK_CF_PREVIEW_ACCOUNT_MISMATCH');
  });
  it('supports colon ownership tags while retaining exact native annotation proof', async () => {
    const tag = 'cossack:' + 'c'.repeat(32);
    const f = fixture({ runner: async args => args.includes('--help') ? ok('--name --worker-name --json --ignore-defaults --tag --skip-confirmation')
      : args[0] === '--version' ? ok('4.147.0') : args[0] === 'whoami' ? ok({ loggedIn: true, accounts: [{ id: accountId }] })
        : ok({ preview, deployment: { ...deployment, annotations: { 'workers/tag': tag } } }) });
    await f.provider.verify();
    expect((await f.provider.deploy(await config(), 'worker', 'pr-42', tag)).deployment).toEqual({ id: deployment.id, tag });
  });
  it('rejects preview versions older than the documented command baseline', async () => {
    expect(await fixture({ runner: async () => ok('4.134.9') }).provider.verify()).toEqual({ status: 'unsupported', code: 'COSSACK_CF_PREVIEW_VERSION_UNSUPPORTED' });
  });
  it('bounds hung tools and aborts their owned cancellation signal', async () => {
    let signal;
    const { provider } = fixture({ timeoutMs: 15, runner: (_args, context) => { signal = context.signal; return new Promise(() => {}); } });
    expect((await provider.verify()).code).toBe('COSSACK_CF_PREVIEW_TIMEOUT');
    expect(signal.aborted).toBe(true);
  });
  it('cancels pending inspection and its response body without exception leakage', async () => {
    const cancel = vi.fn(); const controller = new AbortController();
    const { provider } = fixture({ fetch: async () => new Response(new ReadableStream({ cancel })) });
    const result = provider.inspect('worker', 'pr-42', { signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 5)); controller.abort();
    expect(await result).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_CANCELLED' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('does not issue pre-aborted requests and bounds response and tool output', async () => {
    const fetcher = vi.fn(); const controller = new AbortController(); controller.abort();
    expect((await fixture({ fetch: fetcher }).provider.inspect('worker', 'pr-42', { signal: controller.signal })).code).toBe('COSSACK_CF_PREVIEW_CANCELLED');
    expect(fetcher).not.toHaveBeenCalled();
    expect((await fixture({ fetch: async () => response(preview), maxOutputBytes: 8 }).provider.inspect('worker', 'pr-42')).code).toBe('COSSACK_CF_PREVIEW_OUTPUT_LIMIT');
    expect((await fixture({ runner: async () => ok(token), maxOutputBytes: 8 }).provider.verify()).code).toBe('COSSACK_CF_PREVIEW_OUTPUT_LIMIT');
  });
  it('sanitizes thrown transport exceptions and rejects argument injection', async () => {
    const fetcher = vi.fn(async () => { throw new Error(token); });
    const { provider } = fixture({ fetch: fetcher });
    expect(await provider.inspect('--delete', 'pr-42')).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_REFERENCE_INVALID' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await provider.inspect('worker', 'pr-42')).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_TRANSPORT_FAILED' });
  });

  it('uses the real bounded subprocess runner without reflecting child stdout or stderr', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-preview-native-runner-')); folders.push(root);
    const wrangler = path.join(root, 'node_modules/wrangler');
    await fs.mkdir(path.join(wrangler, 'bin'), { recursive: true });
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ private: true }));
    await fs.writeFile(path.join(wrangler, 'package.json'), JSON.stringify({ name: 'wrangler', version: '4.147.0' }));
    await fs.writeFile(path.join(wrangler, 'bin/wrangler.js'), `process.stderr.write('${token}'.repeat(500)); process.stdout.write('${token}');`);
    const provider = createWranglerPreviewProvider(root, { accountId, token, maxOutputBytes: 100, timeoutMs: 5000 });
    expect(await provider.verify()).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_OUTPUT_LIMIT' });
  });

  it('terminates the real tool process tree when its deadline expires', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-preview-native-cancel-')); folders.push(root);
    const wrangler = path.join(root, 'node_modules/wrangler');
    await fs.mkdir(path.join(wrangler, 'bin'), { recursive: true });
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ private: true }));
    await fs.writeFile(path.join(wrangler, 'package.json'), JSON.stringify({ name: 'wrangler', version: '4.147.0' }));
    const pids = path.join(root, 'pids.json');
    await fs.writeFile(path.join(wrangler, 'bin/wrangler.js'), `
const {spawn}=require('node:child_process');
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
require('node:fs').writeFileSync(${JSON.stringify(pids)},JSON.stringify([process.pid,child.pid]));
setInterval(()=>{},1000);
`);
    const provider = createWranglerPreviewProvider(root, { accountId, token, timeoutMs: 500 });
    expect(await provider.verify()).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_TIMEOUT' });
    const ids = JSON.parse(await fs.readFile(pids, 'utf8'));
    for (const pid of ids) {
      await expect.poll(async () => {
        try {
          process.kill(pid, 0);
          // A Linux orphan may remain briefly as a reaped zombie; it is no
          // longer executing the ignored tool work or retaining open sockets.
          if (process.platform === 'linux') return (await fs.readFile(`/proc/${pid}/stat`, 'utf8')).split(' ')[2] === 'Z';
          return false;
        } catch { return true; }
      }, { timeout: 3000 }).toBe(true);
    }
  });
});

describe('empty native preview creation proof', () => {
  it('creates only an empty account-scoped preview with defaults disabled after verification', async () => {
    const fetcher = vi.fn(async () => response(preview));
    const { provider, calls } = fixture({ fetch: fetcher });
    await provider.verify();
    const result = await provider.createEmptyPreview('worker', 'pr-42');
    expect(result).toEqual({ status: 'created', preview: { id: preview.id, name: preview.name, createdOn: preview.created_on } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/workers/worker/previews?ignore_base_config=true`);
    expect(request).toMatchObject({ method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' } });
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(request.body)).toEqual({ name: 'pr-42' });
    expect(calls).toHaveLength(5); // No upload/settings/resource/delete native command.
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toMatch(/urls|env|settings|resources|deployment/);
  });
  it('never sends a mutation before account/tool verification or after failed verification', async () => {
    const fetcher = vi.fn();
    const { provider } = fixture({ fetch: fetcher });
    expect(await provider.createEmptyPreview('worker', 'pr-42')).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_ACCOUNT_UNVERIFIED' });
    const rejected = fixture({ fetch: fetcher, token: '', runner: async () => ok('4.147.0') }).provider;
    expect(await rejected.verify()).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_AUTH_REQUIRED' });
    expect(await rejected.createEmptyPreview('worker', 'pr-42')).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_ACCOUNT_UNVERIFIED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([['../foreign', 'pr-42'], ['worker/foreign', 'pr-42'], ['worker', 'bad\nname'], ['worker', '']])('rejects invalid worker/name scope %s %s without a request', async (worker, name) => {
    const fetcher = vi.fn(); const { provider } = fixture({ fetch: fetcher }); await provider.verify();
    expect(await provider.createEmptyPreview(worker, name)).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_REFERENCE_INVALID' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { ...preview, id: '../foreign' }, { ...preview, id: '' }, { ...preview, name: 'foreign-name' },
    { ...preview, created_on: 'not-a-date' }, { ...preview, created_on: '2026-99-99T00:00:00.000Z' },
  ])('rejects an invalid or mismatched created identity', async created => {
    const { provider } = fixture({ fetch: async () => response(created) }); await provider.verify();
    expect(await provider.createEmptyPreview('worker', 'pr-42')).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_OUTPUT_INVALID' });
  });
  it.each([403, 404, 409, 500])('redacts %s creation failure without claiming an absent resource', async status => {
    const { provider } = fixture({ fetch: async () => new Response(token, { status }) }); await provider.verify();
    expect(await provider.createEmptyPreview('worker', 'pr-42')).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_CREATION_FAILED' });
  });
  it.each(['redirected', 'foreign-url'])('rejects %s response identity and never follows a redirect', async mode => {
    const created = response(preview);
    Object.defineProperty(created, mode === 'redirected' ? 'redirected' : 'url', { value: mode === 'redirected' ? true : `https://api.cloudflare.com/client/v4/accounts/${'b'.repeat(32)}/workers/workers/worker/previews` });
    const fetcher = vi.fn(async (_url, options) => { expect(options.redirect).toBe('error'); return created; });
    const { provider } = fixture({ fetch: fetcher }); await provider.verify();
    expect(await provider.createEmptyPreview('worker', 'pr-42')).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_RESPONSE_SCOPE_INVALID' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds streamed mutation output without publishing provider bodies', async () => {
    const { provider } = fixture({ maxOutputBytes: 256, fetch: async () => response({ ...preview, secret: token.repeat(30) }) }); await provider.verify();
    expect(await provider.createEmptyPreview('worker', 'pr-42')).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_OUTPUT_LIMIT' });
  });
  it('redacts transport exceptions and malformed success envelopes', async () => {
    for (const fetcher of [async () => { throw new Error(token); }, async () => new Response(token)]) {
      const { provider } = fixture({ fetch: fetcher }); await provider.verify();
      const result = await provider.createEmptyPreview('worker', 'pr-42');
      expect(result.status).toBe('unknown');
      expect(result.code).toMatch(/^COSSACK_CF_PREVIEW_(TRANSPORT_FAILED|OUTPUT_INVALID)$/);
      expect(JSON.stringify(result)).not.toContain(token);
    }
  });
  it.each(['cancel', 'timeout'])('bounds %s while an empty-preview mutation is in flight', async mode => {
    let signal, entered;
    const started = new Promise(resolve => { entered = resolve; });
    const fetcher = vi.fn(async (_url, options) => { signal = options.signal; entered(); return new Promise(() => {}); });
    const controller = new AbortController();
    const { provider } = fixture({ timeoutMs: 30, fetch: fetcher }); await provider.verify();
    const pending = provider.createEmptyPreview('worker', 'pr-42', { signal: controller.signal });
    await started;
    if (mode === 'cancel') controller.abort();
    expect(await pending).toEqual({ status: 'unknown', code: mode === 'cancel' ? 'COSSACK_CF_PREVIEW_CANCELLED' : 'COSSACK_CF_PREVIEW_TIMEOUT' });
    expect(signal.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('makes no POST at all for an already cancelled creation', async () => {
    const fetcher = vi.fn(); const { provider } = fixture({ fetch: fetcher }); await provider.verify();
    const controller = new AbortController(); controller.abort();
    expect(await provider.createEmptyPreview('worker', 'pr-42', { signal: controller.signal })).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_CANCELLED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});


it('negotiates proven legacy defaults bypass for earlier native preview tooling', async () => {
  const calls = [];
  const fetcher = vi.fn(async () => response(preview));
  const runner = async args => {
    calls.push(args);
    if (args.includes('--help')) return ok('--name --worker-name --json --ignore-defaults --tag --skip-confirmation');
    if (args[0] === '--version') return ok('4.135.0');
    if (args[0] === 'whoami') return ok({ loggedIn: true, accounts: [{ id: accountId }] });
    return ok({ preview, deployment });
  };
  const { provider } = fixture({ fetch: fetcher, runner });
  expect(await provider.verify()).toEqual({ status: 'verified', accountId });
  expect((await provider.createEmptyPreview('worker', 'pr-42')).status).toBe('created');
  expect(fetcher.mock.calls[0][0]).toBe(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/workers/worker/previews?ignore_defaults=true`);
  expect((await provider.deploy(await config(), 'worker', 'pr-42', 'cossack-owner-id')).status).toBe('deployed');
  expect(calls.at(-1)).toContain('--ignore-defaults');
  expect(calls.at(-1)).not.toContain('--ignore-base-config');
});

it('declines creation when neither native defaults bypass capability is advertised', async () => {
  const fetcher = vi.fn();
  const runner = async args => args[0] === '--version' ? ok('4.147.0') : ok('--name --worker-name --json --tag --skip-confirmation');
  const { provider } = fixture({ runner, fetch: fetcher });
  expect(await provider.verify()).toEqual({ status: 'unsupported', code: 'COSSACK_CF_PREVIEW_COMMAND_UNSUPPORTED' });
  expect(await provider.createEmptyPreview('worker', 'pr-42')).toEqual({ status: 'unknown', code: 'COSSACK_CF_PREVIEW_ACCOUNT_UNVERIFIED' });
  expect(fetcher).not.toHaveBeenCalled();
});
