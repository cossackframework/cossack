import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWranglerPreviewProvider } from '../src/cloudflare-preview-provider.js';

const accountId = 'a'.repeat(32), token = 'PRIVATE_PROVIDER_TOKEN';
const repository = path.resolve(import.meta.dirname, '../../..');
const preview = { id: 'preview-id', name: 'pr-42', created_on: '2026-10-06T00:00:00.000Z', urls: ['https://pr-42.worker.example.workers.dev'], env: { PRIVATE_TOKEN: token } };
const deployment = { id: 'deployment-id', preview_id: 'preview-id', preview_name: 'pr-42', annotations: { 'workers/tag': 'cossack-owner-id' }, env: { PRIVATE_TOKEN: token } };
const folders = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(folders.splice(0).map(folder => fs.rm(folder, { recursive: true, force: true }))); });
const ok = value => ({ exitCode: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value) });
function fixture(options = {}) {
  const calls = [];
  const runner = options.runner ?? (async (args, context) => {
    calls.push({ args, context });
    if (args.includes('--help')) return ok('--name --worker-name --json --ignore-defaults --tag --skip-confirmation');
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
    expect(calls.at(-1).args).toEqual(['preview', '--name', 'pr-42', '--worker-name', 'worker', '--tag', 'cossack-owner-id', '--json', '--ignore-defaults', '--config', filename]);
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
    const fetcher = vi.fn().mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(response(deployment));
    const { provider } = fixture({ fetch: fetcher });
    expect(await provider.inspect('worker', 'pr-42')).toEqual({ status: 'present', preview: { id: 'preview-id', name: 'pr-42', createdOn: preview.created_on } });
    expect(await provider.inspectDeployment('worker', 'preview-id', 'deployment-id')).toEqual({ status: 'present', deployment: { id: 'deployment-id', tag: 'cossack-owner-id' } });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/workers/worker/previews/pr-42`,
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/workers/worker/previews/preview-id/deployments/deployment-id`,
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
