import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ACCOUNT = /^[a-f0-9]{32}$/i;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,127}$/;
const COMMANDS = {
  d1: { args: ['d1', 'list'], json: true, list: true, id: 'uuid', name: 'name' },
  kv: { args: ['kv', 'namespace', 'list'], list: true, id: 'id', name: 'title' },
  r2: { args: ['r2', 'bucket', 'info'], json: true, positional: 'name', name: 'name' },
  hyperdrive: { args: ['hyperdrive', 'get'], positional: 'id', id: 'id', name: 'name' },
};
const UNSUPPORTED = {
  queue: 'Select a Queue in the target account using Wrangler queues list or the dashboard; this Wrangler version has no supported machine-readable Queue discovery command.',
  workflow: 'Verify the deployed Workflow name, script and class in the target account; Wrangler workflows list/describe output is human-only and is not used as existence evidence.',
  service: 'Verify the Worker service and its requested entrypoint in the target account; deployment history alone does not establish service binding compatibility.',
  'durable-object': 'Verify the Durable Object script, exported class and migration declarations in the target account; this provider has no supported Wrangler namespace discovery command.',
};
function data(object, key) {
  if (!object || typeof object !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
function identifier(value, pattern) { return typeof value === 'string' && pattern.test(value) ? value : undefined; }
function reference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const id = data(value, 'id'), name = data(value, 'name');
  if ((id !== undefined && !identifier(id, ID)) || (name !== undefined && !identifier(name, NAME)) || (id === undefined && name === undefined)) return undefined;
  return { ...(id !== undefined ? { id } : {}), ...(name !== undefined ? { name } : {}) };
}
function commandRunner(binary) {
  return (args, options) => new Promise(resolve => {
    let child, timer, settled = false, bytes = 0; const chunks = [];
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); resolve(value); };
    const stop = code => { child?.kill('SIGKILL'); finish({ exitCode: 1, code, stdout: '' }); };
    const cancel = () => stop('COSSACK_CF_CANCELLED');
    if (options.signal?.aborted) return finish({ exitCode: 1, code: 'COSSACK_CF_CANCELLED', stdout: '' });
    try { child = spawn(process.execPath, [binary, ...args], { cwd: options.cwd, env: options.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { return finish({ exitCode: 1, code: 'COSSACK_CF_TOOL_UNAVAILABLE', stdout: '' }); }
    options.signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => stop('COSSACK_CF_TIMEOUT'), options.timeoutMs);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > options.maxOutputBytes) stop('COSSACK_CF_OUTPUT_LIMIT'); else chunks.push(chunk); });
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > options.maxOutputBytes) stop('COSSACK_CF_OUTPUT_LIMIT'); });
    child.once('error', () => finish({ exitCode: 1, code: 'COSSACK_CF_TOOL_UNAVAILABLE', stdout: '' }));
    child.once('close', exitCode => finish({ exitCode, stdout: Buffer.concat(chunks).toString('utf8') }));
  });
}
/** Read-only account-scoped discovery. No command creates, deploys or deletes resources. */
export function createWranglerResourceProvider(projectRoot, options) {
  const accountId = identifier(data(options, 'accountId'), ACCOUNT)?.toLowerCase();
  if (!accountId) throw new Error('COSSACK_CF_ACCOUNT_INVALID: provide an explicit 32-hex Cloudflare account ID.');
  const environment = data(options, 'environment');
  if (environment !== undefined && !identifier(environment, /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/)) throw new Error('COSSACK_CF_ENV_INVALID: provide a valid environment name.');
  const configPath = data(options, 'configPath');
  if (configPath !== undefined && typeof configPath !== 'string') throw new Error('COSSACK_CF_CONFIG_INVALID: provide a configuration path.');
  const timeoutMs = data(options, 'timeoutMs') ?? 15000, maxOutputBytes = data(options, 'maxOutputBytes') ?? 512 * 1024;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 || !Number.isInteger(maxOutputBytes) || maxOutputBytes < 128 || maxOutputBytes > 1024 * 1024) throw new Error('COSSACK_CF_LIMIT_INVALID: configure bounded tool limits.');
  let runner = data(options, 'runner');
  if (runner !== undefined && typeof runner !== 'function') throw new Error('COSSACK_CF_RUNNER_INVALID: provide a runner function.');
  if (!runner) {
    try { const require = createRequire(path.join(path.resolve(projectRoot), 'package.json')); const filename = require.resolve('wrangler/package.json'); runner = commandRunner(path.join(path.dirname(filename), 'bin/wrangler.js')); }
    catch { runner = async () => ({ exitCode: 1, code: 'COSSACK_CF_TOOL_UNAVAILABLE', stdout: '' }); }
  }
  const outcome = (status, ref = {}, code, action) => ({ status, accountId, reference: ref, ...(code ? { code } : {}), ...(action ? { action } : {}) });
  async function run(args, scope, signal) {
    if (signal?.aborted) return { code: 'COSSACK_CF_CANCELLED' };
    const controller = new AbortController(); let timer, cancel;
    const cancelled = new Promise(resolve => { cancel = () => { controller.abort(); resolve({ code: 'COSSACK_CF_CANCELLED' }); }; signal?.addEventListener('abort', cancel, { once: true }); });
    const expired = new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ code: 'COSSACK_CF_TIMEOUT' }); }, timeoutMs); });
    try {
      const result = await Promise.race([Promise.resolve().then(() => runner([...args, '--config', scope, ...(environment ? ['--env', environment] : [])], {
        cwd: path.resolve(projectRoot), configPath, environment, accountId, timeoutMs, maxOutputBytes, signal: controller.signal,
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_ENV: environment ?? '', CLOUDFLARE_API_BASE_URL: 'https://api.cloudflare.com/client/v4', CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_HIDE_BANNER: 'true', WRANGLER_LOG_SANITIZE: 'true', FORCE_COLOR: '0' },
      })).catch(() => ({ code: 'COSSACK_CF_TOOL_FAILED' })), cancelled, expired]);
      const code = data(result, 'code');
      if (['COSSACK_CF_CANCELLED', 'COSSACK_CF_TIMEOUT', 'COSSACK_CF_OUTPUT_LIMIT', 'COSSACK_CF_TOOL_UNAVAILABLE'].includes(code)) return { code };
      const stdout = data(result, 'stdout');
      if (data(result, 'exitCode') !== 0 || typeof stdout !== 'string') return { code: 'COSSACK_CF_TOOL_FAILED' };
      if (Buffer.byteLength(stdout) > maxOutputBytes) return { code: 'COSSACK_CF_OUTPUT_LIMIT' };
      return { stdout };
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  async function scope(operation) {
    let directory;
    try {
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-account-read-'));
      const filename = path.join(directory, 'wrangler.json');
      await fs.writeFile(filename, JSON.stringify({ account_id: accountId, ...(environment ? { env: { [environment]: { account_id: accountId } } } : {}) }));
      return await operation(filename);
    } catch { return outcome('unknown', {}, 'COSSACK_CF_INSPECTION_FAILED', 'Check local tool access and retry read-only verification.'); }
    finally { if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {}); }
  }
  async function verify(scopePath, signal) {
    const version = await run(['--version'], scopePath, signal);
    if (version.code) return outcome(version.code === 'COSSACK_CF_TOOL_UNAVAILABLE' ? 'unsupported' : 'unknown', {}, version.code, 'Install project Wrangler and authenticate, then retry verification.');
    const match = /^4\.(\d+)\.\d+(?:[-+][a-zA-Z0-9.-]+)?\s*$/.exec(version.stdout.trim());
    if (!match || Number(match[1]) < 114) return outcome('unsupported', {}, 'COSSACK_CF_WRANGLER_VERSION_UNSUPPORTED', 'Use Wrangler 4.114 or a newer 4.x version with the verified JSON command contracts.');
    const help = await run(['whoami', '--help'], scopePath, signal);
    if (help.code) return outcome('unknown', {}, help.code, 'Retry bounded read-only tool verification.');
    if (!/(?:^|\s)--json(?:\s|$)/.test(help.stdout ?? '')) return outcome('unsupported', {}, 'COSSACK_CF_ACCOUNT_JSON_UNSUPPORTED', 'Use a Wrangler version supporting authenticated whoami --json.');
    const result = await run(['whoami', '--json'], scopePath, signal);
    if (result.code) return outcome('unknown', {}, result.code, 'Authenticate Wrangler with account-read permissions and retry.');
    let object;
    try { object = JSON.parse(result.stdout); } catch { return outcome('unknown', {}, 'COSSACK_CF_OUTPUT_INVALID', 'Wrangler must return clean authenticated account JSON; check the installed tool.'); }
    const accounts = data(object, 'accounts');
    if (data(object, 'loggedIn') !== true || !Array.isArray(accounts) || accounts.length > 5000 || accounts.some(item => !identifier(data(item, 'id'), ACCOUNT))) return outcome('unknown', {}, 'COSSACK_CF_ACCOUNT_UNVERIFIED', 'Authenticate Wrangler and grant account-read permissions before selecting resources.');
    if (!accounts.some(item => data(item, 'id').toLowerCase() === accountId)) return outcome('unknown', {}, 'COSSACK_CF_ACCOUNT_MISMATCH', 'The authenticated account list does not include the explicit target account; select the correct account or credentials.');
    return outcome('verified', { id: accountId });
  }
  return {
    async verifyAccount({ signal } = {}) { return scope(filename => verify(filename, signal)); },
    async find(kind, requested, { signal } = {}) {
      const ref = reference(requested);
      if (!ref) return outcome('unknown', {}, 'COSSACK_CF_REFERENCE_INVALID', 'Provide a bounded resource ID or name without control characters.');
      return scope(async filename => {
        const account = await verify(filename, signal); if (account.status !== 'verified') return { ...account, reference: ref };
        if (Object.hasOwn(UNSUPPORTED, kind)) return outcome('unsupported', ref, 'COSSACK_CF_DISCOVERY_UNSUPPORTED', UNSUPPORTED[kind]);
        const command = Object.hasOwn(COMMANDS, kind) ? COMMANDS[kind] : undefined;
        if (!command) return outcome('unsupported', ref, 'COSSACK_CF_RESOURCE_KIND_UNSUPPORTED', 'Choose a supported Cloudflare resource kind; automatic provisioning is not performed.');
        if (command.positional && !ref[command.positional]) return outcome('unsupported', ref, 'COSSACK_CF_LOOKUP_REFERENCE_UNSUPPORTED', `Supply the resource ${command.positional} for this read-only lookup.`);
        const help = await run([...command.args, '--help'], filename, signal);
        if (help.code) return outcome('unknown', ref, help.code, 'Retry bounded read-only tool verification.');
        if (command.json && !/(?:^|\s)--json(?:\s|$)/.test(help.stdout ?? '')) return outcome('unsupported', ref, 'COSSACK_CF_COMMAND_UNSUPPORTED', 'Upgrade project Wrangler or verify this resource explicitly in the target account.');
        const result = await run([...command.args, ...(command.positional ? [ref[command.positional]] : []), ...(command.json ? ['--json'] : [])], filename, signal);
        if (result.code) return outcome('unknown', ref, result.code, 'Check target-account permissions and resource availability, then retry; no existence or provisioning claim was made.');
        let parsed; try { parsed = JSON.parse(result.stdout); } catch { return outcome('unknown', ref, 'COSSACK_CF_OUTPUT_INVALID', 'The tool returned an unsupported output format; use explicit account verification rather than parsing human output.'); }
        const rows = command.list ? parsed : [parsed];
        if (!Array.isArray(rows) || rows.length > 5000) return outcome('unknown', ref, 'COSSACK_CF_OUTPUT_INVALID', 'The resource response exceeded the supported schema or list limit.');
        const candidates = [];
        for (const row of rows) {
          const id = command.id ? identifier(data(row, command.id), ID) : undefined, name = identifier(data(row, command.name), NAME);
          if ((command.id && !id) || !name) return outcome('unknown', ref, 'COSSACK_CF_OUTPUT_INVALID', 'The resource response did not contain valid identity fields.');
          candidates.push({ ...(id ? { id } : {}), name });
        }
        const found = candidates.filter(item => (!ref.id || item.id === ref.id) && (!ref.name || item.name === ref.name));
        if (found.length === 1) return outcome('verified', found[0]);
        if (found.length > 1) return outcome('unknown', ref, 'COSSACK_CF_REFERENCE_AMBIGUOUS', 'Select an explicit unique resource ID before applying the plan.');
        return command.list ? outcome('missing', ref, 'COSSACK_CF_RESOURCE_MISSING', 'Select another resource or explicitly provision the missing resource outside this read-only plan.') : outcome('unknown', ref, 'COSSACK_CF_REFERENCE_MISMATCH', 'The returned resource identity differs from the requested reference; verify it before applying.');
      });
    },
  };
}
