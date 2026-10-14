import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import ts from 'typescript-api';
import { z } from 'zod/v4';
import { inspectDeployment } from './deployment.js';
import { createWranglerResourceProvider } from './cloudflare-resource-provider.js';
import { createJsoncEditor, jsoncProperty, parseJsoncObject } from './jsonc-edit.js';

const fields = {
  d1: ['d1_databases', 'database_id', 'database_name'],
  kv: ['kv_namespaces', 'id'], r2: ['r2_buckets', 'bucket_name'],
  hyperdrive: ['hyperdrive', 'id'], service: ['services', 'service'],
  workflow: ['workflows', 'name'], queue: ['queues', 'queue'],
  'durable-object': ['durable_objects', 'class_name'],
};
const byType = Object.fromEntries(Object.entries(fields).map(([kind, [group]]) => [group, kind]));
const name = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
const selectionsSchema = z.object({ schemaVersion: z.literal(1), resources: z.array(z.object({
  binding: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/),
  kind: z.enum(Object.keys(fields)), mode: z.enum(['existing', 'create']),
  id: z.string().regex(/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i).optional(),
  name: name.optional(),
}).strict()).max(128) }).strict();
const privatePlans = new WeakMap();
const hash = text => createHash('sha256').update(text).digest('hex');
function freeze(value) { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function parseConfig(text, file) {
  const parsed = parseJsoncObject(text, file);
  if (!parsed) fail('COSSACK_RESOURCE_CONFIG_INVALID', 'Resource application requires a valid JSON or JSONC object.');
  return parsed;
}
const property = jsoncProperty;
function selectedNode(source, environment) {
  let node = source.statements[0]?.expression;
  if (environment) node = property(property(node, 'env'), environment);
  return node;
}
function ownedRoot(root, file) {
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) fail('COSSACK_RESOURCE_CONFIG_OUTSIDE_ROOT', 'Resource configuration must be a regular file inside the project.');
}

/** Plan reads only. Remote verification is explicit; no path creates cloud resources. */
export async function planResources(root, { accountId, environment, selections = { schemaVersion: 1, resources: [] }, verify = false, provider, inspect = inspectDeployment } = {}) {
  if (!/^[a-f0-9]{32}$/i.test(accountId ?? '') || /^0+$/.test(accountId)) fail('COSSACK_RESOURCE_ACCOUNT_REQUIRED', 'Supply the intended 32-character Cloudflare account ID explicitly.');
  accountId = accountId.toLowerCase();
  if (environment !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(environment)) fail('COSSACK_RESOURCE_ENVIRONMENT_INVALID', 'Supply an explicit Wrangler environment name.');
  let choices;
  try { choices = selectionsSchema.parse(selections).resources; }
  catch { fail('COSSACK_RESOURCE_SELECTION_INVALID', 'Use schemaVersion 1 and bounded resource selections with binding, kind, mode and explicit ID/name.'); }
  if (new Set(choices.map(item => item.binding)).size !== choices.length) fail('COSSACK_RESOURCE_SELECTION_INVALID', 'Select each binding once.');
  if (choices.some(item => item.id && /^0+$/.test(item.id.replaceAll('-', '')))) fail('COSSACK_RESOURCE_SELECTION_INVALID', 'Resource IDs cannot be placeholders.');
  // Prevent Wrangler's inherited CLOUDFLARE_ENV fallback without changing process state.
  const { config, summary } = await inspect(root, environment ?? '');
  if (config.account_id && config.account_id.toLowerCase() !== accountId) fail('COSSACK_RESOURCE_ACCOUNT_MISMATCH', 'The selected account differs from the configured Wrangler account.');
  const canonicalRoot = await fs.realpath(root);
  const file = await fs.realpath(summary.configPath);
  ownedRoot(canonicalRoot, file);
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 1024 * 1024) fail('COSSACK_RESOURCE_CONFIG_INVALID', 'Resource configuration must be a bounded regular file.');
  const text = await fs.readFile(file, 'utf8');
  const resources = summary.bindings.filter(binding => byType[binding.type]);
  for (const choice of choices) {
    const binding = resources.find(item => item.name === choice.binding);
    if (!binding || byType[binding.type] !== choice.kind) fail('COSSACK_RESOURCE_BINDING_UNKNOWN', 'Selections must match a declared binding and its resource kind in the selected environment.');
    if (choice.kind === 'durable-object') fail('COSSACK_RESOURCE_PROVIDER_MANAGED', 'Durable Object classes and migrations are provider-managed; author their declarations instead of selecting an external ID.');
    const [, idField, namedField] = fields[choice.kind];
    if (choice.mode === 'existing' && (!choice[idField === 'id' || idField === 'database_id' ? 'id' : 'name'] || namedField && !choice.name)) fail('COSSACK_RESOURCE_SELECTION_INVALID', 'Existing selections need their explicit resource ID/name; D1 requires both.');
  }
  const client = verify ? provider ?? createWranglerResourceProvider(root, { accountId, environment, configPath: file }) : undefined;
  let account = { status: 'not-checked', accountId };
  if (client) {
    account = await client.verifyAccount();
    if (account.status !== 'verified' || account.accountId !== accountId) fail('COSSACK_RESOURCE_ACCOUNT_UNVERIFIED', 'Wrangler could not verify access to the explicitly selected account.');
  }
  const entries = [];
  for (const binding of resources) {
    const kind = byType[binding.type], selection = choices.find(item => item.binding === binding.name);
    let mode = selection?.mode ?? (kind === 'durable-object' ? 'provider-managed' : binding.configuration === 'configured' ? 'existing' : 'unresolved');
    const reference = selection ? { ...(selection.id ? { id: selection.id } : {}), ...(selection.name ? { name: selection.name } : {}) }
      : binding.resource ? { [binding.referenceKind === 'id' ? 'id' : 'name']: binding.resource } : {};
    let remote = { status: 'not-checked', action: binding.nextAction ?? 'Verify the selected binding and migrations with project Wrangler before deployment.' };
    if (mode === 'create') remote = { status: 'unsupported', code: 'COSSACK_RESOURCE_PROVISION_UNSUPPORTED', action: `Create the ${kind} explicitly with project Wrangler, then rerun resources with mode existing and its returned ID/name. Cossack never provisions it implicitly.` };
    else if (kind !== 'durable-object' && mode === 'existing' && client) remote = await client.find(kind, reference);
    entries.push({ binding: binding.name, kind, mode, reference, accountId, environment: environment ?? null,
      canCreate: false, remote, configuration: binding.configuration, selected: !!selection });
  }
  const plan = { schemaVersion: 1, projectRoot: canonicalRoot, configPath: file, account, environment: environment ?? null,
    configHash: hash(text), resources: entries, effects: { cloudWrites: 0, localWrites: 0 } };
  privatePlans.set(plan, { file, text, choices, root: canonicalRoot, stat });
  return freeze(plan);
}

/** Apply only verified selections to local JSONC, preserving unrelated bytes and comments. */
export async function applyResourcePlan(plan) {
  const state = privatePlans.get(plan);
  if (!state) fail('COSSACK_RESOURCE_PLAN_INVALID', 'Apply a freshly created in-process resource plan.');
  if (plan.account.status !== 'verified') fail('COSSACK_RESOURCE_ACCOUNT_UNVERIFIED', 'Local application requires explicit authenticated account verification.');
  if (plan.resources.some(item => item.selected && item.remote.status !== 'verified')) fail('COSSACK_RESOURCE_UNRESOLVED', 'Resolve every selected resource action before applying configuration.');
  if (!/\.jsonc?$/i.test(state.file)) fail('COSSACK_RESOURCE_CONFIG_FORMAT_UNSUPPORTED', 'Automatic local application supports JSON/JSONC. Apply the verified selections manually to TOML and rerun the plan.');
  if (await fs.realpath(state.file) !== state.file) fail('COSSACK_RESOURCE_PLAN_STALE', 'The configuration path changed after planning.');
  const current = await fs.readFile(state.file, 'utf8');
  if (current !== state.text) fail('COSSACK_RESOURCE_PLAN_STALE', 'The configuration changed after planning. Create a fresh plan.');
  const { source } = parseConfig(current, state.file);
  const target = selectedNode(source, plan.environment);
  if (!target || !ts.isObjectLiteralExpression(target)) fail('COSSACK_RESOURCE_CONFIG_INVALID', 'The selected environment must be an authored JSON object.');
  const editor = createJsoncEditor(current, source);
  const set = editor.set;
  for (const choice of state.choices) {
    const [group, idField, namedField] = fields[choice.kind];
    let array = property(target, group);
    if (choice.kind === 'queue') array = property(array, 'producers');
    const node = array?.elements?.find(item => property(item, 'binding')?.text === choice.binding);
    if (!node) fail('COSSACK_RESOURCE_CONFIG_INVALID', 'Selections must refer to an authored binding in the selected environment.');
    set(node, idField, idField === 'id' || idField === 'database_id' ? choice.id : choice.name);
    if (namedField) set(node, namedField, choice.name);
  }
  // Pin only the selected environment; changing root account_id for a named
  // environment would redirect other environments that inherit the root.
  set(target, 'account_id', plan.account.accountId);
  let next;
  try { next = editor.apply(); } catch (error) {
    if (error.code === 'COSSACK_JSONC_EDIT_AMBIGUOUS') fail('COSSACK_RESOURCE_CONFIG_INVALID', 'Ambiguous resource edits require manual configuration.');
    throw error;
  }
  parseConfig(next, state.file);
  if (next === current) return { ...plan, effects: { cloudWrites: 0, localWrites: 0 }, applied: 'unchanged' };
  const temporary = state.file + '.cossack-' + randomUUID();
  try {
    await fs.writeFile(temporary, next, { flag: 'wx', mode: state.stat.mode });
    if (await fs.readFile(state.file, 'utf8') !== current) fail('COSSACK_RESOURCE_PLAN_STALE', 'The configuration changed during application.');
    await fs.rename(temporary, state.file);
  } finally { await fs.rm(temporary, { force: true }); }
  return { ...plan, configHash: hash(next), effects: { cloudWrites: 0, localWrites: 1 }, applied: 'updated' };
}
