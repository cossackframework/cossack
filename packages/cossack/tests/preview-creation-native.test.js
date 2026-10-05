import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { expect, it } from 'vitest';

const gate = process.env.COSSACK_PREVIEW_INSTALLED_ROOT;
const toolRoot = gate ?? process.env.COSSACK_PREVIEW_NATIVE_TOOL_ROOT;
it.skipIf(!toolRoot)('persists empty creation proof before real Wrangler deployment fails and safely retries cleanup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-preview-empty-native-'));
  const accountId = 'a'.repeat(32), token = 'dummy-local-only-token';
  const require = createRequire(path.join(toolRoot, 'package.json'));
  const binary = path.join(path.dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js');
  const providerModule = gate ? path.join(gate, 'node_modules/cossack/src/cloudflare-preview-provider.js') : '../src/cloudflare-preview-provider.js';
  const serviceModule = gate ? path.join(gate, 'node_modules/cossack/src/preview-service.js') : '../src/preview-service.js';
  const { createWranglerPreviewProvider } = await import(providerModule);
  const { createPreview, inspectPreview, cleanupPreview } = await import(serviceModule);
  const seen = []; let preview, deleteAttempts = 0, failDelete = true;
  const envelope = (res, result, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(status === 200 ? { success: true, result } : { success: false, errors: [{ code: status === 404 ? 10025 : 999, message: 'private-test-provider-detail' }] })); };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, 'http://localhost'); seen.push({ method: req.method, path: url.pathname, query: url.search, body, contentType: req.headers['content-type'] });
    if (req.method === 'GET' && url.pathname.endsWith('/accounts')) return envelope(res, [{ id: accountId, name: 'local-fixture' }]);
    if (req.method === 'GET' && url.pathname.endsWith('/memberships')) return envelope(res, [{ id: 'membership-id', status: 'accepted', account: { id: accountId, name: 'local-fixture' }, roles: ['Administrator'] }]);
    if (req.method === 'GET' && url.pathname.endsWith('/user/tokens/verify')) return envelope(res, { id: 'token-id', status: 'active' });
    if (req.method === 'GET' && url.pathname.endsWith('/user')) return envelope(res, { id: 'user-id', email: 'local@example.test' });
    const prefix = `/client/v4/accounts/${accountId}/workers/workers/worker/previews`;
    if (req.method === 'POST' && url.pathname === prefix) {
      const input = JSON.parse(body);
      expect(input).toEqual({ name: input.name }); expect(url.search).toBe('?ignore_base_config=true'); expect(preview).toBeUndefined();
      preview = { id: 'owned-empty-id', name: input.name, created_on: '2026-10-06T03:00:00Z', urls: [`https://${input.name}-worker.local.workers.dev`] };
      return envelope(res, preview);
    }
    if (req.method === 'GET' && url.pathname.startsWith(prefix + '/')) {
      if (!preview || url.pathname.endsWith('/deployments/latest')) return envelope(res, null, 404);
      return envelope(res, preview);
    }
    if (req.method === 'PATCH' && preview && url.pathname === prefix + '/' + preview.name) return envelope(res, preview);
    if (req.method === 'POST' && preview && url.pathname === prefix + '/' + preview.id + '/deployments') {
      const saved = JSON.parse(await fs.readFile(path.join(root, '.cossack/preview.json'), 'utf8'));
      expect(saved.status).toBe('created'); expect(saved.preview.id).toBe(preview.id); expect(saved.deployment).toBeUndefined();
      return envelope(res, null, 500);
    }
    if (req.method === 'DELETE' && preview && url.pathname === prefix + '/' + preview.id) {
      deleteAttempts++;
      if (failDelete) return envelope(res, null, 500);
      preview = undefined; return envelope(res, {});
    }
    return envelope(res, null, 500);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const api = `http://127.0.0.1:${server.address().port}/client/v4`;
  // Only the destination is replaced by a loopback fixture. Commands and their
  // real native JSON/exit behavior remain the installed Wrangler implementation.
  const runner = (args, options) => new Promise(resolve => {
    const child = execFile(process.execPath, [binary, ...args], { cwd: options.cwd, env: { ...options.env, CLOUDFLARE_API_BASE_URL: api, WRANGLER_SEND_ERROR_REPORTS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false' }, timeout: options.timeoutMs, maxBuffer: options.maxOutputBytes, signal: options.signal, detached: process.platform !== 'win32' }, (error, stdout) => resolve({ exitCode: error ? typeof error.code === 'number' ? error.code : 1 : 0, stdout }));
    const kill = () => { try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL'); } catch {} };
    options.signal.addEventListener('abort', kill, { once: true });
    const timer = setTimeout(kill, options.timeoutMs); timer.unref();
    child.once('close', () => { clearTimeout(timer); options.signal.removeEventListener('abort', kill); });
  });
  const provider = createWranglerPreviewProvider(root, { accountId, token, runner, fetch: async (url, options) => { const response = await fetch(url.replace('https://api.cloudflare.com/client/v4', api), options); const mapped = new Response(response.body, { status: response.status, headers: response.headers }); Object.defineProperty(mapped, 'url', { value: url }); return mapped; }, timeoutMs: 25000 });
  const verify = provider.verify.bind(provider);
  provider.verify = async () => { const result = await verify(); expect(result.status, JSON.stringify({ result, paths: seen.map(item => item.path) })).toBe('verified'); return result; };
  const config = { name: 'worker', vars: { MODE: 'production' }, previews: { vars: { MODE: 'staging' } } };
  try {
    const artifact = path.join(root, 'wrangler.json');
    await fs.writeFile(path.join(root, 'worker.js'), 'export default {fetch(){return new Response("ok")}};');
    await fs.writeFile(artifact, JSON.stringify({ ...config, main: 'worker.js', compatibility_date: '2026-10-01' }));
    const dependencies = { provider, inspect: async () => ({ config }), build: async () => artifact, fetch: async () => { throw new Error('Smoke must not run after failed deployment'); } };
    await expect(createPreview(root, { accountId, name: 'empty' }, dependencies)).rejects.toMatchObject({ code: 'COSSACK_PREVIEW_CREATE_UNKNOWN' });
    const filename = path.join(root, '.cossack/preview.json');
    const original = await fs.readFile(filename, 'utf8');
    expect(JSON.parse(original)).toMatchObject({ status: 'unknown', preview: { id: 'owned-empty-id' } });
    expect(original).not.toMatch(/dummy-local-only-token|private-test-provider-detail/);
    expect((await inspectPreview(root, { accountId }, dependencies)).status).toBe('owned');
    expect(await fs.readFile(filename, 'utf8')).toBe(original);
    await expect(cleanupPreview(root, { accountId }, dependencies)).rejects.toMatchObject({ code: 'COSSACK_PREVIEW_DELETE_UNKNOWN' });
    failDelete = false;
    expect((await cleanupPreview(root, { accountId }, dependencies)).status).toBe('cleaned');
    expect((await cleanupPreview(root, { accountId }, dependencies)).status).toBe('cleaned');
    expect(deleteAttempts).toBe(2);
    expect(seen.filter(item => item.method === 'POST' && item.path.endsWith('/previews'))).toHaveLength(1);
    const mutations = seen.filter(item => item.method !== 'GET');
    expect(mutations.every(item => item.path.startsWith(`/client/v4/accounts/${accountId}/workers/workers/worker/previews`))).toBe(true);
    expect(mutations.some(item => item.path.endsWith('/deployments'))).toBe(true);
    const upload = mutations.find(item => item.path.endsWith('/deployments'));
    const form = await new Request('http://local.test/upload', { method: 'POST', headers: { 'Content-Type': upload.contentType }, body: upload.body }).formData();
    const uploaded = JSON.parse(form.get('metadata'));
    expect(uploaded.env.MODE).toEqual({ type: 'plain_text', text: 'staging' });
    expect(mutations.some(item => item.query === '?ignore_base_config=true')).toBe(true);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); }
}, 150000);
