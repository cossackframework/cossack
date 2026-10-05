import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readPreviewSecrets } from './preview-secrets.js';
import { inspectDeployment } from './deployment.js';
import { runCaptured } from './spawn.js';
import { createWranglerPreviewProvider } from './cloudflare-preview-provider.js';

const accountPattern = /^[a-f0-9]{32}$/i;
const namePattern = /^[a-z0-9][a-z0-9-]{0,62}$/;
const error = code => Object.assign(new Error('Preview operation stopped. Inspect the saved journal and explicit staging configuration; no unverified resource is deleted.'), { code: `COSSACK_PREVIEW_${code}` });
const references = { d1_databases: 'database_id', kv_namespaces: 'id', r2_buckets: 'bucket_name' };
const unsupported = ['services', 'workflows', 'queues', 'hyperdrive', 'vectorize', 'analytics_engine_datasets', 'dispatch_namespaces', 'send_email', 'mtls_certificates', 'pipelines', 'secrets_store_secrets', 'artifacts', 'flagship', 'ratelimits', 'worker_loaders', 'vpc_services', 'browser', 'ai', 'images', 'stream', 'media', 'unsafe', 'tail_consumers'];
const hasItems = value => Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' ? Object.values(value).some(hasItems) : !!value;

/** Deliberately narrow: native previews do not create isolated external bindings. */
export function validatePreviewConfig(config, accountId) {
  if (!accountPattern.test(accountId ?? '') || /^0+$/.test(accountId)) throw error('ACCOUNT_REQUIRED');
  if (config.account_id && config.account_id.toLowerCase() !== accountId.toLowerCase()) throw error('ACCOUNT_MISMATCH');
  if (!namePattern.test(config.name ?? '') || !config.previews || typeof config.previews !== 'object') throw error('CONFIG_REQUIRED');
  const preview = structuredClone(config.previews);
  const allowed = new Set(['vars', 'durable_objects', ...Object.keys(references), 'observability', 'logpush']);
  if (Object.keys(preview).some(key => !allowed.has(key) && hasItems(preview[key])) || unsupported.some(key => hasItems(config[key])) || hasItems(config.triggers?.crons)) throw error('BINDING_UNSUPPORTED');
  for (const key of Object.keys(preview)) if (!allowed.has(key)) delete preview[key];
  const retained = [];
  for (const [group, reference] of Object.entries(references)) {
    const production = config[group] ?? [];
    const staging = preview[group] ?? [];
    if (!Array.isArray(staging)) throw error('CONFIG_INVALID');
    for (const binding of production) if (!staging.some(item => item.binding === binding.binding)) throw error('BINDING_MISSING');
    const seen = new Set();
    for (const binding of staging) {
      if (!binding.binding || seen.has(binding.binding) || typeof binding[reference] !== 'string' || !binding[reference].trim() || /^(?:0+|<.*>|YOUR.*)$/i.test(binding[reference]) || production.some(item => item[reference] === binding[reference])) throw error('RESOURCE_SHARED');
      seen.add(binding.binding);
      retained.push({ kind: group, binding: binding.binding, ownership: 'existing-staging', cleanup: 'retain' });
    }
  }
  const objects = config.durable_objects?.bindings ?? [];
  preview.durable_objects ??= { bindings: structuredClone(objects) };
  if (!Array.isArray(preview.durable_objects.bindings)) throw error('CONFIG_INVALID');
  for (const binding of [...objects, ...preview.durable_objects.bindings]) if (binding.script_name || binding.environment || !binding.name || !binding.class_name) throw error('EXTERNAL_DURABLE_OBJECT');
  for (const binding of objects) if (!preview.durable_objects.bindings.some(item => item.name === binding.name && item.class_name === binding.class_name)) throw error('BINDING_MISSING');
  for (const binding of preview.durable_objects.bindings) retained.push({ kind: 'durable-object', binding: binding.name, ownership: 'native-preview', cleanup: 'provider' });
  for (const name of Object.keys(config.vars ?? {})) if (!Object.hasOwn(preview.vars ?? {}, name)) throw error('VARIABLE_MISSING');
  for (const name of Object.keys(preview.vars ?? {})) if (/(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ACCESS_KEY)/i.test(name)) throw error('SECRET_IN_VARS');
  return { preview, retained };
}

async function statePath(root, selected = '.cossack/preview.json') {
  const filename = path.resolve(root, selected);
  const relative = path.relative(root, filename);
  if (!relative.startsWith(`.cossack${path.sep}`) || relative.split(path.sep).includes('..') || !filename.endsWith('.json')) throw error('STATE_PATH_INVALID');
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw error('STATE_PATH_INVALID'); }
    catch (caught) { if (caught.code !== 'ENOENT') throw caught; }
  }
  return filename;
}
async function acquireLock(filename) {
  const lockPath = `${filename}.lock`;
  const claim = async () => {
    const handle = await fs.open(lockPath, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({ pid: process.pid, host: os.hostname() }));
    return handle;
  };
  try { return await claim(); } catch (caught) {
    if (caught.code !== 'EEXIST') throw caught;
    // A terminated local CLI leaves its lock behind. A transferred CI artifact
    // contains only the journal; never remove a live or foreign-host lock.
    let previous;
    try { const stat = await fs.lstat(lockPath); if (!stat.isFile() || stat.size > 1024) throw error('STATE_BUSY'); previous = JSON.parse(await fs.readFile(lockPath, 'utf8')); }
    catch { throw error('STATE_BUSY'); }
    if (previous.host !== os.hostname() || !Number.isInteger(previous.pid) || previous.pid < 1) throw error('STATE_BUSY');
    try { process.kill(previous.pid, 0); throw error('STATE_BUSY'); }
    catch (probe) { if (probe.code !== 'ESRCH') throw error('STATE_BUSY'); }
    await fs.rm(lockPath);
    try { return await claim(); } catch { throw error('STATE_BUSY'); }
  }
}
async function save(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
  try { await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, filename); }
  finally { await fs.rm(temporary, { force: true }); }
}
async function load(filename, accountId) {
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size > 64 * 1024) throw error('STATE_INVALID');
  const value = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (value.schemaVersion !== 1 || !accountPattern.test(value.accountId ?? '') || !namePattern.test(value.worker ?? '') || !namePattern.test(value.name ?? '') || !/^cossack:[a-f0-9]{32}$/.test(value.tag ?? '') || !['intent', 'deployed', 'smoke-failed', 'unknown', 'cleaned'].includes(value.status)) throw error('STATE_INVALID');
  if (!Array.isArray(value.resources) || value.resources.length > 128 || value.resources.some(item => !item || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(item.binding ?? '') ||
    !(Object.hasOwn(references, item.kind) && item.ownership === 'existing-staging' && item.cleanup === 'retain' || item.kind === 'durable-object' && item.ownership === 'native-preview' && item.cleanup === 'provider') ||
    Object.keys(item).some(key => !['kind', 'binding', 'ownership', 'cleanup'].includes(key)))) throw error('STATE_INVALID');
  if (accountId && value.accountId.toLowerCase() !== accountId.toLowerCase()) throw error('ACCOUNT_MISMATCH');
  return value;
}
async function build(root) {
  // Reuse the deployment gate, including declared configuration, source stripping
  // and configured build budgets, without nested output in the public protocol.
  const result = await runCaptured(process.execPath, [fileURLToPath(new URL('../bin/cossack.js', import.meta.url)), 'deploy', '--dry-run', '--json'], { cwd: root, shell: false, timeoutMs: 240_000, maxOutputBytes: 128 * 1024, env: { CLOUDFLARE_ENV: '', COSSACK_COMMAND_TIMEOUT_MS: '235000' } });
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { throw error('BUILD_FAILED'); }
  if (result.code !== 0 || parsed.command !== 'deploy' || parsed.ok !== true || typeof parsed.data?.artifact !== 'string') throw error('BUILD_FAILED');
  return parsed.data.artifact;
}
async function smoke(url, route, request) {
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || route.includes('\\')) throw error('SMOKE_PATH_INVALID');
  const target = new URL(route, url);
  if (target.origin !== new URL(url).origin || target.username || target.password || target.protocol !== 'https:') throw error('SMOKE_PATH_INVALID');
  let response;
  try { response = await request(target, { redirect: 'manual', signal: AbortSignal.timeout(15_000) }); }
  catch { throw error('SMOKE_FAILED'); }
  const status = response.status;
  await response.body?.cancel().catch(() => {});
  if (status < 200 || status >= 300) throw error('SMOKE_FAILED');
  return { status, path: target.pathname };
}

export async function createPreview(root, options, dependencies = {}) {
  const { name, state, dryRun = false, smokePath = '/' } = options;
  const accountId = options.accountId?.toLowerCase();
  if (!namePattern.test(name ?? '')) throw error('NAME_INVALID');
  const filename = await statePath(root, state);
  const inspection = await (dependencies.inspect ?? inspectDeployment)(root);
  const { preview, retained } = validatePreviewConfig(inspection.config, accountId);
  const secretBindings = await readPreviewSecrets(root, options.secretsFile, inspection.config.secrets?.required ?? []);
  // Validate before any build, journal write, authenticated read or mutation.
  if (!smokePath.startsWith('/') || smokePath.startsWith('//') || smokePath.includes('\\')) throw error('SMOKE_PATH_INVALID');
  if (dryRun) return { status: 'planned', accountId, worker: inspection.config.name, resources: retained, requiredSecrets: secretBindings.map(binding => binding.name), effects: { localWrites: 0, cloudWrites: 0 }, limitations: ['Existing staging bindings are retained; shared unsupported bindings require separate deployment.', 'Remote CI acceptance is not established by a local plan.'] };
  const provider = dependencies.provider ?? createWranglerPreviewProvider(root, { accountId });
  if ((await provider.verify()).status !== 'verified') throw error('PROVIDER_UNVERIFIED');
  // No overwrite: an earlier failed operation must stay inspectable.
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const lock = await acquireLock(filename);
  try {
    try { await fs.access(filename); throw error('STATE_EXISTS'); } catch (caught) { if (caught.code !== 'ENOENT') throw caught; }
    const artifact = await (dependencies.build ?? build)(root);
    const artifactConfig = JSON.parse(await fs.readFile(artifact, 'utf8'));
    const nonce = randomBytes(16).toString('hex');
    const journal = { schemaVersion: 1, accountId, worker: inspection.config.name, name: `cossack-${name.slice(0,20)}-${nonce.slice(0,16)}`, tag: `cossack:${nonce}`, status: 'intent', resources: retained };
    // Recheck the actual artifact before preparing a preview; Vite must not
    // substitute a Worker or bind another account after source inspection.
    if (artifactConfig.name !== journal.worker || artifactConfig.account_id && artifactConfig.account_id.toLowerCase() !== accountId.toLowerCase()) throw error('ARTIFACT_MISMATCH');
    const prepared = { ...artifactConfig, account_id: accountId, previews: { ...preview, ...(secretBindings.length ? { unsafe: { bindings: secretBindings } } : {}) } };
    delete prepared.env;
    const configPath = path.join(path.dirname(artifact), `cossack-preview-${nonce}.json`);
    await fs.writeFile(configPath, JSON.stringify(prepared), { flag: 'wx', mode: 0o600 });
    try {
      if ((await provider.inspect(journal.worker, journal.name)).status !== 'absent') throw error('NAME_NOT_AVAILABLE');
      await save(filename, journal);
      const receipt = await provider.deploy(configPath, journal.worker, journal.name, journal.tag);
      if (receipt.status !== 'deployed' || receipt.preview.name !== journal.name || receipt.deployment.tag !== journal.tag) {
        journal.status = 'unknown'; await save(filename, journal); throw error('CREATE_UNKNOWN');
      }
      Object.assign(journal, { status: 'deployed', preview: receipt.preview, deployment: receipt.deployment, url: receipt.url });
      await save(filename, journal);
      try { journal.smoke = await smoke(receipt.url, smokePath, dependencies.fetch ?? fetch); }
      catch (caught) { journal.status = 'smoke-failed'; await save(filename, journal); throw caught; }
      await save(filename, journal);
      return journal;
    } finally { await fs.rm(configPath, { force: true }); }
  } finally { await lock.close(); await fs.rm(`${filename}.lock`, { force: true }); }
}

async function inspectOwned(provider, journal) {
  // Latest deployment evidence both recovers a lost receipt and prevents an
  // older tagged version from authorizing removal after someone else redeploys.
  if (provider.recoverDeployment) {
    const recovered = await provider.recoverDeployment(journal.worker, journal.name, journal.tag);
    if (recovered.status === 'absent' && recovered.code === 'COSSACK_CF_PREVIEW_ABSENT') return { status: 'absent' };
    if (recovered.status !== 'recovered' || recovered.preview.name !== journal.name || recovered.deployment.tag !== journal.tag) throw error('OWNERSHIP_UNPROVEN');
    if (journal.preview && (recovered.preview.id !== journal.preview.id || recovered.preview.createdOn !== journal.preview.createdOn) || journal.deployment && recovered.deployment.id !== journal.deployment.id) throw error('OWNERSHIP_UNPROVEN');
    return { status: 'owned', preview: recovered.preview, deployment: recovered.deployment };
  }
  // Test/providers without recovery still require their original persisted proof.
  const remote = await provider.inspect(journal.worker, journal.name);
  if (remote.status === 'absent') return { status: 'absent' };
  if (remote.status !== 'present') throw error('INSPECTION_UNKNOWN');
  if (!journal.preview || !journal.deployment || remote.preview.id !== journal.preview.id || remote.preview.name !== journal.name || remote.preview.createdOn !== journal.preview.createdOn) throw error('OWNERSHIP_UNPROVEN');
  const deployed = await provider.inspectDeployment(journal.worker, journal.preview.id, journal.deployment.id);
  if (deployed.status !== 'present' || deployed.deployment.id !== journal.deployment.id || deployed.deployment.tag !== journal.tag) throw error('OWNERSHIP_UNPROVEN');
  return { status: 'owned', preview: remote.preview, deployment: deployed.deployment };
}
export async function inspectPreview(root, options, dependencies = {}) {
  const filename = await statePath(root, options.state);
  const journal = await load(filename, options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID);
  const provider = dependencies.provider ?? createWranglerPreviewProvider(root, { accountId: journal.accountId });
  if ((await provider.verify()).status !== 'verified') throw error('PROVIDER_UNVERIFIED');
  return { ...await inspectOwned(provider, journal), accountId: journal.accountId, worker: journal.worker, name: journal.name, journalStatus: journal.status };
}
export async function cleanupPreview(root, options, dependencies = {}) {
  const filename = await statePath(root, options.state);
  const lock = await acquireLock(filename);
  try {
    const journal = await load(filename, options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID);
    const provider = dependencies.provider ?? createWranglerPreviewProvider(root, { accountId: journal.accountId });
    if ((await provider.verify()).status !== 'verified') throw error('PROVIDER_UNVERIFIED');
    const ownership = await inspectOwned(provider, journal);
    if (ownership.status !== 'absent') {
      if (!journal.preview || !journal.deployment) {
        Object.assign(journal, { preview: ownership.preview, deployment: ownership.deployment });
        await save(filename, journal); // Persist recovered provider proof before removal.
      }
      const configPath = `${filename}.${randomBytes(8).toString('hex')}.cleanup.json`;
      await fs.writeFile(configPath, JSON.stringify({ name: journal.worker, account_id: journal.accountId, previews: {} }), { flag: 'wx', mode: 0o600 });
      try {
        const result = await provider.remove(configPath, journal.worker, journal.preview.id);
        // Lost delete responses can converge only after provider-confirmed absence.
        const remaining = await provider.inspect(journal.worker, journal.name);
        if (remaining.status !== 'absent') { journal.status = 'unknown'; await save(filename, journal); throw error(result.status === 'removed' ? 'DELETE_NOT_CONFIRMED' : 'DELETE_UNKNOWN'); }
      } finally { await fs.rm(configPath, { force: true }); }
    }
    journal.status = 'cleaned'; await save(filename, journal);
    return { status: 'cleaned', accountId: journal.accountId, worker: journal.worker, name: journal.name, resources: journal.resources };
  } finally { await lock.close(); await fs.rm(`${filename}.lock`, { force: true }); }
}
