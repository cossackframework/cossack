import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createWranglerResourceProvider } from '../src/cloudflare-resource-provider.js';
const accountId = 'a'.repeat(32), other = 'b'.repeat(32);
const root = path.resolve(import.meta.dirname, '../../..');
const ok = value => ({ exitCode: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value) });
function fixture(response = [{ uuid: 'resource-id', name: 'database' }], accounts = [accountId]) {
  const calls = [], configs = [];
  const runner = async (args, ctx) => {
    calls.push(args); const config = args[args.indexOf('--config') + 1]; configs.push(config);
    expect(JSON.parse(await fs.readFile(config, 'utf8')).account_id).toBe(accountId);
    expect(ctx.env.CLOUDFLARE_ACCOUNT_ID).toBe(accountId);
    expect(ctx.env.CLOUDFLARE_ENV).toBe('production');
    if (args[0] === '--version') return ok('4.114.0');
    if (args.includes('--help')) return ok('Options: --json output');
    if (args[0] === 'whoami') return ok({ loggedIn: true, accounts: accounts.map(id => ({ id })), token: 'private-auth-token' });
    return ok(response);
  };
  return { provider: createWranglerResourceProvider(root, { accountId, runner, environment: 'production', configPath: '/original/app.jsonc' }), calls, configs };
}
describe('account-scoped resource discovery', () => {
  it('verifies identities and cleans isolated configuration without leaking output extras', async () => {
    const f = fixture([{ uuid: 'resource-id', name: 'database', password: 'private-password' }]);
    expect(await f.provider.find('d1', { id: 'resource-id', name: 'database' })).toEqual({ status: 'verified', accountId, reference: { id: 'resource-id', name: 'database' } });
    for (const filename of f.configs) await expect(fs.stat(filename)).rejects.toThrow();
    expect(f.calls.every(args => !args.includes('/original/app.jsonc'))).toBe(true);
  });
  it('wrong authenticated account never invokes resource discovery', async () => {
    const f = fixture([], [other]);
    expect(await f.provider.find('d1', { name: 'database' })).toMatchObject({ status: 'unknown', code: 'COSSACK_CF_ACCOUNT_MISMATCH' });
    expect(f.calls.some(args => args[0] === 'd1')).toBe(false);
  });
  it('requires both supplied identity fields to match a complete list', async () => {
    const f = fixture();
    expect(await f.provider.find('d1', { id: 'different', name: 'database' })).toMatchObject({ status: 'missing', code: 'COSSACK_CF_RESOURCE_MISSING' });
  });
  it('does not select an ambiguous name', async () => {
    const f = fixture([{ uuid: 'one', name: 'database' }, { uuid: 'two', name: 'database' }]);
    expect(await f.provider.find('d1', { name: 'database' })).toMatchObject({ status: 'unknown', code: 'COSSACK_CF_REFERENCE_AMBIGUOUS' });
  });
  it.each(['queue', 'workflow', 'service', 'durable-object', 'constructor'])('returns actionable unsupported %s without guessed commands', async kind => {
    const f = fixture(); const result = await f.provider.find(kind, { name: 'resource' });
    expect(result.status).toBe('unsupported'); expect(result.action.length).toBeGreaterThan(20);
    expect(f.calls).toHaveLength(3);
  });
  it.each([['kv', [{ id: 'namespace-id', title: 'namespace', token: 'private' }], { id: 'namespace-id', name: 'namespace' }], ['r2', { name: 'bucket', password: 'private' }, { name: 'bucket' }], ['hyperdrive', { id: 'connection-id', name: 'connection', origin: { password: 'private' } }, { id: 'connection-id', name: 'connection' }]])('sanitizes %s machine output', async (kind, output, expected) => {
    expect(await fixture(output).provider.find(kind, expected)).toEqual({ status: 'verified', accountId, reference: expected });
  });
  it.each(['banner\n[]', '{invalid', 'human table', [{ uuid: 'valid', name: '\nsecret' }]])('rejects untrusted schema without reflecting it', async output => {
    const result = await fixture(output).provider.find('d1', { name: 'database' });
    expect(result.code).toBe('COSSACK_CF_OUTPUT_INVALID'); expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('rejects argument injection and does not read accessors', async () => {
    let reads = 0; const f = fixture();
    expect((await f.provider.find('r2', { name: '--delete' })).code).toBe('COSSACK_CF_REFERENCE_INVALID');
    expect((await f.provider.find('d1', { get name() { reads++; return 'secret'; } })).code).toBe('COSSACK_CF_REFERENCE_INVALID');
    expect(reads).toBe(0); expect(f.calls).toHaveLength(0);
  });
  it('bounds hanging injected tools and cancellation', async () => {
    const provider = createWranglerResourceProvider(root, { accountId, timeoutMs: 15, runner: () => new Promise(() => {}) });
    expect((await provider.verifyAccount()).code).toBe('COSSACK_CF_TIMEOUT');
    const controller = new AbortController(); const pending = provider.verifyAccount({ signal: controller.signal }); controller.abort();
    expect((await pending).code).toBe('COSSACK_CF_CANCELLED');
  });
  it.each([['4.113.0', 'COSSACK_CF_WRANGLER_VERSION_UNSUPPORTED'], ['5.0.0', 'COSSACK_CF_WRANGLER_VERSION_UNSUPPORTED'], ['x'.repeat(129), 'COSSACK_CF_OUTPUT_LIMIT']])('gates unsupported or oversized tool output', async (stdout, code) => {
    const provider = createWranglerResourceProvider(root, { accountId, maxOutputBytes: 128, runner: async () => ok(stdout) });
    expect((await provider.verifyAccount()).code).toBe(code);
  });
  it('native Wrangler reads account and D1 JSON exclusively through isolated loopback API', async () => {
    const requests = []; let mismatch = false;
    const server = http.createServer((req, res) => {
      requests.push({ method: req.method, url: req.url });
      let result;
      if (req.url.startsWith('/client/v4/user/tokens/verify')) result = { id: 'fixture', status: 'active' };
      else if (req.url === '/client/v4/user') result = { email: 'fixture@example.test' };
      else if (req.url === '/client/v4/accounts' || req.url.startsWith('/client/v4/accounts?')) result = [{ id: mismatch ? other : accountId, name: 'Fixture' }];
      else if (req.url.startsWith('/client/v4/memberships')) result = [{ account: { id: mismatch ? other : accountId, name: 'Fixture' }, status: 'accepted' }];
      else if (req.url.startsWith(`/client/v4/accounts/${accountId}/d1/database`)) result = [{ uuid: 'native-id', name: 'native-db' }];
      else { res.writeHead(404); return res.end('{}'); }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ success: true, result, result_info: { page: 1, per_page: 10, total_pages: 1, total_count: 1 } }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const runner = async (args, ctx) => {
        const env = { ...ctx.env, CLOUDFLARE_API_TOKEN: 'fixture-only-token', CLOUDFLARE_API_BASE_URL: `http://127.0.0.1:${server.address().port}/client/v4` }; delete env.CLOUDFLARE_API_KEY; delete env.CLOUDFLARE_EMAIL;
        try { const { stdout } = await promisify(execFile)(process.execPath, [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), ...args], { cwd: root, env, signal: ctx.signal, timeout: ctx.timeoutMs, maxBuffer: ctx.maxOutputBytes }); return ok(stdout); } catch { return { exitCode: 1, stdout: '' }; }
      };
      const provider = createWranglerResourceProvider(root, { accountId, runner });
      expect(await provider.find('d1', { name: 'native-db' })).toEqual({ status: 'verified', accountId, reference: { id: 'native-id', name: 'native-db' } });
      const before = requests.filter(r => r.url.includes('/d1/')).length; mismatch = true;
      expect((await provider.find('d1', { name: 'native-db' })).code).toBe('COSSACK_CF_ACCOUNT_MISMATCH');
      expect(requests.filter(r => r.url.includes('/d1/'))).toHaveLength(before);
      expect(requests.every(r => r.method === 'GET')).toBe(true);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }, 30000);
});
