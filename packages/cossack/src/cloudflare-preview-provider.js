import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const API = 'https://api.cloudflare.com/client/v4';
const ACCOUNT = /^[a-f0-9]{32}$/i;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/;
const TAG = /^[a-zA-Z0-9][\x20-\x7e]{0,127}$/;
const KNOWN = new Set(['COSSACK_CF_PREVIEW_CANCELLED', 'COSSACK_CF_PREVIEW_TIMEOUT', 'COSSACK_CF_PREVIEW_OUTPUT_LIMIT', 'COSSACK_CF_PREVIEW_TOOL_UNAVAILABLE']);
const unknown = code => ({ status: 'unknown', code });
const data = (value, key) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const property = Object.getOwnPropertyDescriptor(value, key);
  return property && 'value' in property ? property.value : undefined;
};
const valid = (value, pattern = IDENTIFIER) => typeof value === 'string' && pattern.test(value);
function previewRecord(value) {
  const id = data(value, 'id'), name = data(value, 'name'), createdOn = data(value, 'created_on');
  if (!valid(id) || !valid(name, NAME) || typeof createdOn !== 'string' || createdOn.length > 64 || !/^\d{4}-\d{2}-\d{2}T/.test(createdOn) || !Number.isFinite(Date.parse(createdOn))) return undefined;
  return { id, name, createdOn };
}
function deploymentRecord(value, previewId, name) {
  const id = data(value, 'id'), tag = data(data(value, 'annotations'), 'workers/tag');
  if (!valid(id) || typeof tag !== 'string' || tag.length < 1 || tag.length > 128 || /[^\x20-\x7e]/.test(tag)
    || data(value, 'preview_id') !== previewId || (name !== undefined && data(value, 'preview_name') !== name)) return undefined;
  return { id, tag };
}
function providerUrl(preview, deployment) {
  const candidates = data(preview, 'urls') ?? data(deployment, 'urls');
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 32) return undefined;
  const urls = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.length > 2048) return undefined;
    let url;
    try { url = new URL(candidate); } catch { return undefined; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/'
      || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+workers\.dev$/.test(url.hostname)) return undefined;
    urls.push(url.origin);
  }
  return urls.find(url => new URL(url).hostname.endsWith('.workers.dev')) ?? urls[0];
}

function nativeRunner(binary) {
  return (args, options) => new Promise(resolve => {
    let child, settled = false, bytes = 0;
    const chunks = [];
    const finish = value => { if (settled) return; settled = true; options.signal.removeEventListener('abort', cancel); resolve(value); };
    const stop = () => {
      if (!child?.pid) return;
      if (process.platform === 'win32') {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => child.kill('SIGKILL'));
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    };
    const cancel = () => { stop(); finish({ code: 'COSSACK_CF_PREVIEW_CANCELLED' }); };
    if (options.signal.aborted) return cancel();
    try { child = spawn(process.execPath, [binary, ...args], { cwd: options.cwd, env: options.env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { return finish({ code: 'COSSACK_CF_PREVIEW_TOOL_UNAVAILABLE' }); }
    options.signal.addEventListener('abort', cancel, { once: true });
    const output = (chunk, capture) => {
      bytes += chunk.length;
      if (bytes > options.maxOutputBytes) { stop(); finish({ code: 'COSSACK_CF_PREVIEW_OUTPUT_LIMIT' }); }
      else if (capture) chunks.push(chunk);
    };
    child.stdout.on('data', chunk => output(chunk, true));
    child.stderr.on('data', chunk => output(chunk, false));
    child.once('error', () => finish({ code: 'COSSACK_CF_PREVIEW_TOOL_UNAVAILABLE' }));
    child.once('close', exitCode => finish({ exitCode, stdout: Buffer.concat(chunks).toString('utf8') }));
  });
}

/** Native Wrangler mutations and account-scoped read-only REST inspection. */
export function createWranglerPreviewProvider(projectRoot, options = {}) {
  const accountId = typeof options.accountId === 'string' ? options.accountId.toLowerCase() : undefined;
  const token = options.token ?? process.env.CLOUDFLARE_API_TOKEN;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
  if (!valid(accountId, ACCOUNT)) throw new TypeError('COSSACK_CF_PREVIEW_ACCOUNT_INVALID');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000
    || !Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 8 * 1024 * 1024) throw new TypeError('COSSACK_CF_PREVIEW_LIMITS_INVALID');
  const root = path.resolve(projectRoot);
  let runner = options.runner, verified = false;
  if (!runner) {
    try {
      const require = createRequire(path.join(root, 'package.json'));
      runner = nativeRunner(path.join(path.dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js'));
    } catch { runner = async () => ({ code: 'COSSACK_CF_PREVIEW_TOOL_UNAVAILABLE' }); }
  }
  const fetcher = options.fetch ?? globalThis.fetch;
  const auth = () => typeof token === 'string' && token.length > 0 && token.length <= 4096 && !/[^\x21-\x7e]/.test(token);

  async function bounded(operation, signal) {
    if (signal?.aborted) return unknown('COSSACK_CF_PREVIEW_CANCELLED');
    const controller = new AbortController();
    let timer, cancelled;
    const cancellation = new Promise(resolve => {
      cancelled = () => { controller.abort(); resolve(unknown('COSSACK_CF_PREVIEW_CANCELLED')); };
      signal?.addEventListener('abort', cancelled, { once: true });
    });
    const deadline = new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(unknown('COSSACK_CF_PREVIEW_TIMEOUT')); }, timeoutMs); });
    try {
      return await Promise.race([Promise.resolve().then(() => operation(controller.signal)).catch(() => unknown('COSSACK_CF_PREVIEW_TRANSPORT_FAILED')), cancellation, deadline]);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancelled); }
  }
  async function run(args, signal) {
    if (!auth()) return unknown('COSSACK_CF_PREVIEW_AUTH_REQUIRED');
    return bounded(async ownedSignal => {
      const result = await runner(args, { cwd: root, signal: ownedSignal, timeoutMs, maxOutputBytes,
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: token,
          CLOUDFLARE_API_BASE_URL: API, CLOUDFLARE_ENV: '', CI: 'true', WRANGLER_SEND_METRICS: 'false',
          WRANGLER_HIDE_BANNER: 'true', WRANGLER_LOG_SANITIZE: 'true', FORCE_COLOR: '0' } });
      const code = data(result, 'code');
      if (KNOWN.has(code)) return unknown(code);
      const stdout = data(result, 'stdout');
      if (data(result, 'exitCode') !== 0 || typeof stdout !== 'string') return unknown('COSSACK_CF_PREVIEW_TOOL_FAILED');
      if (Buffer.byteLength(stdout) > maxOutputBytes) return unknown('COSSACK_CF_PREVIEW_OUTPUT_LIMIT');
      return { status: 'ok', stdout };
    }, signal);
  }
  async function read(worker, identifiers, signal) {
    if (!auth()) return unknown('COSSACK_CF_PREVIEW_AUTH_REQUIRED');
    if (!valid(worker) || identifiers.some(value => !valid(value, NAME))) return unknown('COSSACK_CF_PREVIEW_REFERENCE_INVALID');
    const suffix = '/accounts/' + accountId + '/workers/workers/' + encodeURIComponent(worker) + '/previews/'
      + encodeURIComponent(identifiers[0]) + (identifiers[1] ? '/deployments/' + encodeURIComponent(identifiers[1]) : '');
    return bounded(async ownedSignal => {
      const response = await fetcher(API + suffix, { method: 'GET', headers: { authorization: 'Bearer ' + token, accept: 'application/json' }, redirect: 'error', signal: ownedSignal });
      if (response.status === 404) { await response.body?.cancel(); return { status: 'absent' }; }
      if (!response.ok) { await response.body?.cancel(); return unknown('COSSACK_CF_PREVIEW_INSPECTION_FAILED'); }
      const reader = response.body?.getReader();
      if (!reader) return unknown('COSSACK_CF_PREVIEW_OUTPUT_INVALID');
      const cancelBody = () => { void reader.cancel().catch(() => {}); };
      ownedSignal.addEventListener('abort', cancelBody, { once: true });
      const chunks = []; let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxOutputBytes) { await reader.cancel(); return unknown('COSSACK_CF_PREVIEW_OUTPUT_LIMIT'); }
          chunks.push(value);
        }
      } finally { ownedSignal.removeEventListener('abort', cancelBody); reader.releaseLock(); }
      let envelope;
      try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return unknown('COSSACK_CF_PREVIEW_OUTPUT_INVALID'); }
      if (data(envelope, 'success') !== true || !data(envelope, 'result')) return unknown('COSSACK_CF_PREVIEW_OUTPUT_INVALID');
      return { status: 'ok', result: data(envelope, 'result') };
    }, signal);
  }
  async function configuration(configPath) {
    try {
      const filename = path.resolve(root, configPath);
      const info = await fs.stat(filename);
      if (!info.isFile()) return unknown('COSSACK_CF_PREVIEW_CONFIG_INVALID');
      if (info.size > maxOutputBytes) return unknown('COSSACK_CF_PREVIEW_OUTPUT_LIMIT');
      const source = await fs.readFile(filename, 'utf8');
      if (Buffer.byteLength(source) > maxOutputBytes) return unknown('COSSACK_CF_PREVIEW_OUTPUT_LIMIT');
      const config = JSON.parse(source);
      if (data(config, 'account_id') !== accountId) return unknown('COSSACK_CF_PREVIEW_ACCOUNT_MISMATCH');
      return { status: 'ok', filename };
    } catch { return unknown('COSSACK_CF_PREVIEW_CONFIG_INVALID'); }
  }
  return {
    async verify({ signal } = {}) {
      verified = false;
      let directory;
      try {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-preview-account-'));
        const config = path.join(directory, 'wrangler.json');
        await fs.writeFile(config, JSON.stringify({ account_id: accountId }));
        const version = await run(['--version', '--config', config], signal);
        if (version.status !== 'ok') return version;
        const match = /^4\.(\d+)\.\d+(?:[-+][\w.-]+)?\s*$/.exec(version.stdout.trim());
        if (!match || Number(match[1]) < 135) return { status: 'unsupported', code: 'COSSACK_CF_PREVIEW_VERSION_UNSUPPORTED' };
        for (const [args, flags] of [
          [['preview', '--help'], ['--name', '--worker-name', '--json', '--ignore-defaults', '--tag']],
          [['preview', 'delete', '--help'], ['--name', '--worker-name', '--skip-confirmation']],
          [['whoami', '--help'], ['--json']],
        ]) {
          const help = await run([...args, '--config', config], signal);
          if (help.status !== 'ok') return help;
          if (flags.some(flag => !new RegExp('(?:^|\\s)' + flag + '(?:\\s|$)').test(help.stdout))) return { status: 'unsupported', code: 'COSSACK_CF_PREVIEW_COMMAND_UNSUPPORTED' };
        }
        const result = await run(['whoami', '--json', '--config', config], signal);
        if (result.status !== 'ok') return result;
        let value;
        try { value = JSON.parse(result.stdout); } catch { return unknown('COSSACK_CF_PREVIEW_OUTPUT_INVALID'); }
        const accounts = data(value, 'accounts');
        if (data(value, 'loggedIn') !== true || !Array.isArray(accounts) || accounts.length > 5000
          || accounts.some(account => !valid(data(account, 'id'), ACCOUNT))) return unknown('COSSACK_CF_PREVIEW_ACCOUNT_UNVERIFIED');
        if (!accounts.some(account => data(account, 'id').toLowerCase() === accountId)) return unknown('COSSACK_CF_PREVIEW_ACCOUNT_MISMATCH');
        verified = true;
        return { status: 'verified', accountId };
      } catch { return unknown('COSSACK_CF_PREVIEW_VERIFICATION_FAILED'); }
      finally { if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {}); }
    },
    async inspect(worker, name, { signal } = {}) {
      const value = await read(worker, [name], signal);
      if (value.status !== 'ok') return value;
      const preview = previewRecord(value.result);
      return preview && preview.name === name ? { status: 'present', preview } : unknown('COSSACK_CF_PREVIEW_OUTPUT_INVALID');
    },
    async inspectDeployment(worker, previewId, deploymentId, { signal } = {}) {
      const value = await read(worker, [previewId, deploymentId], signal);
      if (value.status !== 'ok') return value;
      const deployment = deploymentRecord(value.result, previewId);
      return deployment && deployment.id === deploymentId ? { status: 'present', deployment } : unknown('COSSACK_CF_PREVIEW_OUTPUT_INVALID');
    },
    async deploy(configPath, worker, name, tag, { signal } = {}) {
      if (!verified) return unknown('COSSACK_CF_PREVIEW_ACCOUNT_UNVERIFIED');
      if (!valid(worker) || !valid(name, NAME) || !valid(tag, TAG)) return unknown('COSSACK_CF_PREVIEW_REFERENCE_INVALID');
      const config = await configuration(configPath); if (config.status !== 'ok') return config;
      const value = await run(['preview', '--name', name, '--worker-name', worker, '--tag', tag, '--json', '--ignore-defaults', '--config', config.filename], signal);
      if (value.status !== 'ok') return value;
      let result;
      try { result = JSON.parse(value.stdout); } catch { return unknown('COSSACK_CF_PREVIEW_OUTPUT_INVALID'); }
      const rawPreview = data(result, 'preview'), rawDeployment = data(result, 'deployment');
      const preview = previewRecord(rawPreview), deployment = preview && deploymentRecord(rawDeployment, preview.id, name);
      const url = providerUrl(rawPreview, rawDeployment);
      return preview && preview.name === name && deployment?.tag === tag && url
        ? { status: 'deployed', preview, deployment, url } : unknown('COSSACK_CF_PREVIEW_OUTPUT_INVALID');
    },
    // The native API accepts name or immutable ID. Ownership-aware cleanup
    // supplies the verified receipt ID to avoid replacing-by-name races.
    async remove(configPath, worker, identifier, { signal } = {}) {
      if (!verified) return unknown('COSSACK_CF_PREVIEW_ACCOUNT_UNVERIFIED');
      if (!valid(worker) || !valid(identifier, NAME)) return unknown('COSSACK_CF_PREVIEW_REFERENCE_INVALID');
      const config = await configuration(configPath); if (config.status !== 'ok') return config;
      const value = await run(['preview', 'delete', '--name', identifier, '--worker-name', worker, '--skip-confirmation', '--config', config.filename], signal);
      return value.status === 'ok' ? { status: 'removed' } : value;
    },
  };
}
