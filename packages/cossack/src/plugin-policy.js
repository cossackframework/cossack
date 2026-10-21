/**
 * Policy lints for rendered plugins (`src/plugins/<name>/`). Plugins are trusted build-time
 * modules, so their source must stay within what their manifest declares:
 *
 * - COSSACK_PLUGIN_RAW_QUERY: no FastDB client, host internals or FastQL text. Data goes
 *   through `context.cms` repositories.
 * - COSSACK_PLUGIN_NETWORK: no global fetch, sockets or HTTP modules for other hosts; use
 *   `context.fetch` with a literal URL on a host in `permissions.network`.
 * - COSSACK_PLUGIN_PERMISSION: permissions and resources the code names must be declared.
 * - COSSACK_PLUGIN_SECRET: no host secrets or `process.env`.
 * - COSSACK_PLUGIN_HOOK: handlers only for extension points the manifest declares.
 *
 * Source is parsed, never executed.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/** CMS extension points by their exported binding name in `@cossackframework/cms`. */
export const EXTENSION_POINT_EXPORTS = Object.freeze({
  beforeWrite: 'cms.resource.before-write', afterCommit: 'cms.resource.after-commit',
  formValidate: 'cms.form.validate', formBeforeSubmit: 'cms.form.before-submit', formPrefill: 'cms.form.prefill',
  formConfirmation: 'cms.form.confirmation', formNotification: 'cms.form.notification', formSubmitted: 'cms.form.submitted',
});
/** Permissions the CMS host defines. */
export const HOST_PERMISSIONS = Object.freeze(['cms:dashboard']);
const SECRET = /^(?:FASTDB_TOKEN|FASTDB_URL|APP_SECRET|CMS_SETUP_CODE|OAUTH_SECRET)$|(?:_SECRET|_TOKEN|_PASSWORD|_KEY)$/;
// Statement text in upper case, as FastQL is written; prose such as "Select a role from…" does not match.
const SQL = /^\s*(?:SELECT|INSERT|UPDATE|DELETE|UPSERT|CREATE|DEFINE|REMOVE|DROP|ALTER|RELATE|INFO|BEGIN|COMMIT|WITH)\s[\s\S]*\b(?:FROM|INTO|SET|TABLE|FIELD|INDEX|SCHEMA|FOR|WHERE|AS)\b/;
const NETWORK_MODULES = new Set(['node:http', 'node:https', 'node:net', 'node:tls', 'node:dgram', 'http', 'https', 'net', 'tls', 'dgram', 'cloudflare:sockets', 'undici', 'ws']);
const DB_METHODS = new Set(['read', 'write', 'prepareWrite', 'submit', 'recover', 'writeAtomic', 'warm']);

/**
 * Lint one rendered plugin. `files` are `{ path, source }` with project-relative paths;
 * `parse(filename, source)` returns `{ program, errors }` like Vite's `parseSync`.
 */
export function lintPlugin({ manifest, files, parse }) {
  const diagnostics = [];
  const name = manifest?.name ?? 'unknown';
  // Its resources, and the site collections it ships, stored as cms/<name>.
  const own = new Set([...(manifest?.resources ?? []).map(resource => `${name}/${resource.name}`), ...(manifest?.collections ?? []).map(collection => `cms/${collection.name}`)]);
  const granted = new Set(Object.keys(manifest?.permissions?.resources ?? {}));
  const defined = new Set(manifest?.permissions?.define ?? []);
  const hosts = manifest?.permissions?.network ?? [];
  const hooks = new Set((manifest?.hooks ?? []).map(hook => hook.point));
  const ownPermission = permission => [...own].some(id => ['*', 'read', 'create', 'update', 'delete'].some(action => permission === `${id}:${action}`));
  const knownPermission = permission => defined.has(permission) || HOST_PERMISSIONS.includes(permission) || ownPermission(permission);

  // Manifest data that names permissions.
  const manifestFile = `src/plugins/${name}/plugin.json`;
  const report = (file, code, message, offset = 0, source = '') => {
    const { line, column } = position(source, offset);
    diagnostics.push({ code, severity: 'error', plugin: name, file, line, column, message });
  };
  for (const command of manifest?.commands ?? []) if (command.permission && !knownPermission(command.permission)) report(manifestFile, 'COSSACK_PLUGIN_PERMISSION', `Command ${command.name} requires ${command.permission}, which the manifest does not define.`);
  for (const [slot, links] of Object.entries(manifest?.ui?.slots ?? {})) for (const link of links ?? []) {
    if (link.permission && !knownPermission(link.permission)) report(manifestFile, 'COSSACK_PLUGIN_PERMISSION', `Slot ${slot} link ${link.label} requires ${link.permission}, which the manifest does not define.`);
  }
  for (const resource of manifest?.resources ?? []) for (const rule of rules(resource.access)) {
    if (!knownPermission(rule)) report(manifestFile, 'COSSACK_PLUGIN_PERMISSION', `Resource ${resource.name} access requires ${rule}, which the manifest does not define.`);
  }

  for (const file of files) {
    if (!/\.(?:[cm]?ts|tsx|[cm]?js)$/.test(file.path) || /\.d\.ts$/.test(file.path) || /\.(?:test|spec)\./.test(file.path)) continue;
    let parsed;
    try { parsed = parse(path.basename(file.path), file.source); }
    catch (error) { report(file.path, 'COSSACK_PLUGIN_PARSE', `The file could not be parsed: ${error.message}`); continue; }
    if (parsed.errors?.length) { report(file.path, 'COSSACK_PLUGIN_PARSE', `The file could not be parsed: ${parsed.errors[0].message}`); continue; }
    const fail = (code, message, node) => report(file.path, code, message, node?.start ?? 0, file.source);
    const points = new Map();
    walk(parsed.program, (node, parent) => {
      switch (node.type) {
        case 'ImportDeclaration': case 'ExportNamedDeclaration': case 'ExportAllDeclaration': {
          const source = node.source?.value;
          if (typeof source !== 'string') break;
          const typeOnly = node.importKind === 'type' || node.exportKind === 'type' ||
            (node.type === 'ImportDeclaration' && node.specifiers?.length > 0 && node.specifiers.every(specifier => specifier.importKind === 'type'));
          if (!typeOnly && (source === '@cossackframework/fastdb' || (source.startsWith('@cossackframework/fastdb/') && source !== '@cossackframework/fastdb/values'))) {
            fail('COSSACK_PLUGIN_RAW_QUERY', `Plugins do not use the FastDB client (${source}). Use context.cms repositories.`, node);
          }
          if (!typeOnly && source === '@cossackframework/cms/server') fail('COSSACK_PLUGIN_RAW_QUERY', 'Plugins do not import the CMS host. Use the context passed to register().', node);
          if (NETWORK_MODULES.has(source)) fail('COSSACK_PLUGIN_NETWORK', `Plugins do not open connections with ${source}. Use context.fetch with a granted host.`, node);
          if (node.type === 'ImportDeclaration' && source === '@cossackframework/cms') {
            for (const specifier of node.specifiers ?? []) {
              const imported = specifier.imported?.name ?? specifier.imported?.value;
              if (imported && EXTENSION_POINT_EXPORTS[imported]) points.set(specifier.local.name, EXTENSION_POINT_EXPORTS[imported]);
            }
          }
          break;
        }
        case 'ImportExpression': {
          const source = node.source?.value;
          if (typeof source === 'string' && (source.startsWith('@cossackframework/fastdb') || source === '@cossackframework/cms/server')) fail('COSSACK_PLUGIN_RAW_QUERY', `Plugins do not load ${source}.`, node);
          if (typeof source === 'string' && NETWORK_MODULES.has(source)) fail('COSSACK_PLUGIN_NETWORK', `Plugins do not open connections with ${source}.`, node);
          break;
        }
        case 'Literal': case 'StringLiteral': {
          if (typeof node.value === 'string' && SQL.test(node.value) && !isImportSource(parent)) fail('COSSACK_PLUGIN_RAW_QUERY', 'This text looks like a FastQL statement. Plugins read and write through context.cms repositories.', node);
          break;
        }
        case 'TemplateLiteral': {
          const text = node.quasis.map(quasi => quasi.value?.cooked ?? quasi.value?.raw ?? '').join('?');
          if (SQL.test(text) && parent?.type !== 'TaggedTemplateExpression') fail('COSSACK_PLUGIN_RAW_QUERY', 'This template looks like a FastQL statement. Plugins read and write through context.cms repositories.', node);
          break;
        }
        case 'MemberExpression': case 'StaticMemberExpression': {
          const property = propertyName(node);
          if (property === 'db' && parent && (parent.type === 'MemberExpression' || parent.type === 'StaticMemberExpression') && DB_METHODS.has(propertyName(parent))) {
            fail('COSSACK_PLUGIN_RAW_QUERY', `Plugins do not call the database binding (db.${propertyName(parent)}). Use context.cms repositories.`, node);
          }
          if (property && SECRET.test(property) && isEnvObject(node.object)) fail('COSSACK_PLUGIN_SECRET', `Plugins do not read host secrets (${property}).`, node);
          if (property === 'env' && node.object?.type === 'Identifier' && node.object.name === 'process') fail('COSSACK_PLUGIN_SECRET', 'Plugins do not read process.env. Declare configuration in src/plugins/<name>/config.', node);
          break;
        }
        case 'ComputedMemberExpression': {
          if (isEnvObject(node.object) && typeof node.expression?.value === 'string' && SECRET.test(node.expression.value)) fail('COSSACK_PLUGIN_SECRET', `Plugins do not read host secrets (${node.expression.value}).`, node);
          break;
        }
        case 'NewExpression': {
          const callee = calleeName(node.callee);
          if (['WebSocket', 'EventSource', 'XMLHttpRequest'].includes(callee)) fail('COSSACK_PLUGIN_NETWORK', `Plugins do not open ${callee} connections. Use context.fetch with a granted host.`, node);
          break;
        }
        case 'CallExpression': {
          const callee = calleeName(node.callee);
          const method = node.callee && (node.callee.type === 'MemberExpression' || node.callee.type === 'StaticMemberExpression') ? propertyName(node.callee) : undefined;
          const first = node.arguments?.[0];
          if (callee === 'fetch' || callee === 'globalThis.fetch' || callee === 'window.fetch' || callee === 'self.fetch') {
            // Same-origin calls from components are fine; other hosts need the granted context.fetch.
            const url = literalUrl(first);
            if (url === undefined || !url.startsWith('/') || url.startsWith('//')) fail('COSSACK_PLUGIN_NETWORK', 'Plugins call other hosts with context.fetch and a literal URL on a host in permissions.network.', node);
          } else if (method === 'fetch') {
            const url = literalUrl(first);
            if (url === undefined) fail('COSSACK_PLUGIN_NETWORK', 'Use a literal URL (or a template with a literal origin) so the host can be checked.', node);
            else if (!url.startsWith('/')) {
              let host;
              try { host = new URL(url).hostname; } catch { host = undefined; }
              if (!host || !hosts.some(entry => entry === host || (entry.startsWith('*.') && host.endsWith(entry.slice(1))))) {
                fail('COSSACK_PLUGIN_NETWORK', `${host ?? url} is not in permissions.network.`, node);
              }
            }
          }
          if ((callee === 'hasPermission' || callee === 'requirePermission') && node.arguments?.length) {
            const permission = stringValue(node.arguments[callee === 'hasPermission' ? 1 : 0]);
            if (permission === undefined) fail('COSSACK_PLUGIN_PERMISSION', 'Name permissions with string literals so they can be checked against the manifest.', node);
            else if (!knownPermission(permission)) fail('COSSACK_PLUGIN_PERMISSION', `${permission} is not defined in permissions.define.`, node);
          }
          if (method === 'resource' && node.arguments?.length === 1) {
            const id = stringValue(first);
            if (id === undefined) fail('COSSACK_PLUGIN_PERMISSION', 'Name resources with string literals so they can be checked against the manifest.', node);
            else if (/^[a-z][a-z0-9-]*\/[a-z][a-z0-9_]*$/.test(id) && !own.has(id) && !granted.has(id)) fail('COSSACK_PLUGIN_PERMISSION', `${id} is not one of the plugin's resources or in permissions.resources.`, node);
          }
          if ((method === 'addFilter' || method === 'addAction') && first?.type === 'Identifier' && points.has(first.name)) {
            const point = points.get(first.name);
            if (!hooks.has(point)) fail('COSSACK_PLUGIN_HOOK', `${point} is not declared in the manifest hooks.`, node);
          }
          if (callee === 'env' && typeof stringValue(first) === 'string' && SECRET.test(stringValue(first))) fail('COSSACK_PLUGIN_SECRET', `Plugins do not read host secrets (${stringValue(first)}).`, node);
          // Request context: the host only as c.get('cms').pluginCms('<own name>'); never the auth kit.
          if (method === 'get' && (stringValue(first) === 'cms' || stringValue(first) === 'cmsAuth')) {
            const scoped = stringValue(first) === 'cms' && parent && (parent.type === 'MemberExpression' || parent.type === 'StaticMemberExpression') && propertyName(parent) === 'pluginCms';
            if (!scoped) fail('COSSACK_PLUGIN_RAW_QUERY', `Plugins use c.get('cms').pluginCms('${name}'), not the whole host.`, node);
          }
          if (method === 'pluginCms' && stringValue(first) !== name) fail('COSSACK_PLUGIN_PERMISSION', `pluginCms() takes the plugin's own name, ${name}.`, node);
          break;
        }
        case 'Property': case 'ObjectProperty': {
          if (propertyKey(node) === 'permission') {
            const permission = stringValue(node.value);
            if (permission !== undefined && !knownPermission(permission)) fail('COSSACK_PLUGIN_PERMISSION', `${permission} is not defined in permissions.define.`, node);
          }
          break;
        }
      }
    });
  }
  return diagnostics;
}

/** Read and lint every rendered plugin in a project. */
export async function lintProjectPlugins(root, { only, parse } = {}) {
  const parser = parse ?? (await import('vite')).parseSync;
  const directory = path.join(root, 'src/plugins');
  const names = (await fs.readdir(directory, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const results = [];
  for (const name of names) {
    if (only && name !== only) continue;
    const manifestPath = path.join(directory, name, 'plugin.json');
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); }
    catch {
      results.push({ plugin: name, files: 0, diagnostics: [{ code: 'COSSACK_PLUGIN_MANIFEST_INVALID', severity: 'error', plugin: name, file: `src/plugins/${name}/plugin.json`, line: 1, column: 1, message: 'The rendered manifest is missing or is not JSON.' }] });
      continue;
    }
    const files = [];
    for (const entry of await fs.readdir(path.join(directory, name), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const absolute = path.join(entry.parentPath, entry.name);
      files.push({ path: path.relative(root, absolute).split(path.sep).join('/'), source: await fs.readFile(absolute, 'utf8') });
    }
    results.push({ plugin: name, files: files.length, diagnostics: lintPlugin({ manifest, files, parse: parser }) });
  }
  return results;
}

/** Vite plugin: plugin policy errors fail builds and are reported in development. */
export function cossackPluginPolicy() {
  let root = process.cwd();
  return {
    name: 'cossack-plugin-policy',
    configResolved(config) { root = config.root; },
    async buildStart() {
      const results = await lintProjectPlugins(root);
      const diagnostics = results.flatMap(result => result.diagnostics);
      if (!diagnostics.length) return;
      const message = `[cossack] Plugin policy:\n${diagnostics.map(formatPolicyDiagnostic).join('\n')}`;
      if (this.environment?.mode === 'dev') this.warn(message);
      else this.error({ code: diagnostics[0].code, message, id: path.join(root, diagnostics[0].file) });
    },
  };
}

export function formatPolicyDiagnostic(diagnostic) {
  return `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} - ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
}

function rules(access) {
  const found = [];
  const visit = rule => {
    if (rule && typeof rule === 'object') {
      if (typeof rule.permission === 'string') found.push(rule.permission);
      if (Array.isArray(rule.any)) rule.any.forEach(visit);
    }
  };
  Object.values(access ?? {}).forEach(visit);
  return found;
}

function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const item of node) walk(item, visit, parent); return; }
  if (typeof node.type === 'string') visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue;
    if (value && typeof value === 'object') walk(value, visit, typeof node.type === 'string' ? node : parent);
  }
}

function propertyName(node) {
  if (!node) return undefined;
  if (node.computed) return typeof node.property?.value === 'string' ? node.property.value : undefined;
  return node.property?.name;
}

function propertyKey(node) {
  return node.key?.name ?? (typeof node.key?.value === 'string' ? node.key.value : undefined);
}

function calleeName(node) {
  if (!node) return undefined;
  if (node.type === 'Identifier') return node.name;
  if ((node.type === 'MemberExpression' || node.type === 'StaticMemberExpression') && node.object?.type === 'Identifier' && !node.computed) return `${node.object.name}.${node.property?.name}`;
  return undefined;
}

function isEnvObject(node) {
  if (!node) return false;
  if (node.type === 'Identifier') return node.name === 'env';
  if (node.type === 'MemberExpression' || node.type === 'StaticMemberExpression') return propertyName(node) === 'env';
  return false;
}

function isImportSource(parent) {
  return parent && ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(parent.type);
}

function stringValue(node) {
  if (!node) return undefined;
  if ((node.type === 'Literal' || node.type === 'StringLiteral') && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value?.cooked;
  return undefined;
}

/** A literal URL, or the literal prefix of a template whose origin is fixed. */
function literalUrl(node) {
  const text = stringValue(node);
  if (text !== undefined) return text;
  if (node?.type === 'TemplateLiteral') {
    const head = node.quasis[0]?.value?.cooked ?? '';
    if (/^https?:\/\/[^/]+\//.test(head) || head.startsWith('/')) return head;
  }
  return undefined;
}

function position(source, offset) {
  let line = 1;
  let column = 1;
  for (let index = 0; index < Math.min(offset, source.length); index++) {
    if (source[index] === '\n') { line++; column = 1; } else column++;
  }
  return { line, column };
}
