/**
 * `cossack <plugin>:<command>`: commands declared in a rendered plugin manifest. Help and
 * options come from the manifest; the handler runs in the application, as a signed-in
 * dashboard user, behind the same permissions as the dashboard.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { findProjectRoot } from './fs-utils.js';
import { commandFailure, writeResult } from './output.js';
import { assertCredentialTarget, CmsApiError, httpAllowed } from './cms/client.js';
import { signInFailure } from './cms/login.js';
import { loginKey, readLogins } from './cms/logins.js';

const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The manifest command for `plugin:command`, or undefined. Reads data only. */
export async function findPluginCommand(raw, cwd = process.cwd()) {
  const [plugin, name, ...extra] = String(raw).split(':');
  if (extra.length || !NAME.test(plugin ?? '') || !/^[a-z][a-z0-9-]{0,40}$/.test(name ?? '')) return undefined;
  const root = await findProjectRoot(cwd);
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(root, 'src/plugins', plugin, 'plugin.json'), 'utf8')); }
  catch { return undefined; }
  const command = (manifest.commands ?? []).find(entry => entry.name === name);
  return command ? { root, plugin, command } : undefined;
}

export function pluginCommandHelp(plugin, command) {
  const options = Object.entries(command.options ?? {}).map(([name, rule]) =>
    `  --${name}${rule.type === 'boolean' ? '' : ` <${rule.type}>`}${rule.required ? ' (required)' : ''}  ${rule.description ?? ''}`.trimEnd());
  return `cossack ${plugin}:${command.name}${options.length ? ' [options]' : ''}

${command.description}

Runs in the application as a signed-in dashboard user${command.permission ? ` with ${command.permission}` : ''}.
Signs in with the application password from cossack cms login or COSSACK_CMS_TOKEN; otherwise
set CMS_PASSWORD with --email or CMS_EMAIL. The application comes from --url or APP_URL.

Options:
${[...options, '  --url <url>  Application URL.', '  --email <email>  Dashboard user.', '  --allow-http  Allow plain HTTP to a development host (or COSSACK_CMS_ALLOW_HTTP=1).', '  --json  Emit versioned JSON.', '  --help  Show this help.'].join('\n')}`;
}

export async function runPluginCommand(raw, rest, found) {
  const json = rest.includes('--json');
  const { plugin, command, root } = found;
  const label = `${plugin}:${command.name}`;
  if (rest.includes('--help') || rest.includes('-h')) {
    if (json) writeResult(label, { data: { help: pluginCommandHelp(plugin, command) } });
    else console.log(pluginCommandHelp(plugin, command));
    return 0;
  }
  const ctx = { flags: { json } };
  const parsed = parseOptions(rest.filter(argument => argument !== '--json'), command);
  if (parsed.problems.length) return commandFailure(ctx, label, 'COSSACK_OPTION_INVALID', parsed.problems.join(' '));
  const environment = await readEnvironment(root);
  const url = (parsed.url ?? process.env.APP_URL ?? environment.APP_URL ?? '').replace(/\/$/, '');
  if (!url) return commandFailure(ctx, label, 'COSSACK_PLUGIN_COMMAND_CREDENTIALS', 'Set --url (or APP_URL).');
  let origin;
  try { origin = new URL(url).origin; }
  catch { return commandFailure(ctx, label, 'COSSACK_CMS_URL_INVALID', `${url} is not a URL.`); }
  const source = parsed.url !== undefined || process.env.APP_URL ? 'flag' : 'project';
  const allowHttp = httpAllowed({ 'allow-http': parsed.allowHttp }, process.env);
  // An application password signs in first: COSSACK_CMS_TOKEN, then the stored login for the
  // address (`cossack cms login`). Email and CMS_PASSWORD are the fallback; a site with a bot
  // check or required two-step sign-in refuses them, and the CMS's reason is shown.
  const stored = (await readLogins(process.env)).logins[loginKey(origin, undefined)]?.token;
  const token = process.env.COSSACK_CMS_TOKEN || stored;
  const email = parsed.email ?? process.env.CMS_EMAIL;
  const password = process.env.CMS_PASSWORD;
  const usePassword = !token || Boolean(parsed.email !== undefined && password);
  if (usePassword && (!email || !password)) return commandFailure(ctx, label, 'COSSACK_PLUGIN_COMMAND_CREDENTIALS', 'Run cossack cms login --url <url> (or set COSSACK_CMS_TOKEN), or set --email (or CMS_EMAIL) and CMS_PASSWORD.');
  try {
    if (usePassword) assertCredentialTarget(origin, { source, credential: 'CMS_PASSWORD', allowHttp });
    else assertCredentialTarget(origin, { source, credential: process.env.COSSACK_CMS_TOKEN ? 'COSSACK_CMS_TOKEN' : 'the stored application password', fromEnvironment: Boolean(process.env.COSSACK_CMS_TOKEN), allowHttp });
  } catch (error) {
    return commandFailure(ctx, label, error?.code ?? 'COSSACK_CMS_URL_INVALID', error.message);
  }
  let cookies = [];
  if (usePassword) {
    const signIn = await fetch(`${origin}/api/auth/session`, {
      method: 'POST', redirect: 'manual', headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    cookies = signIn.headers.getSetCookie().map(cookie => cookie.split(';')[0]).filter(Boolean);
    if (signIn.status !== 200 || !cookies.length) {
      const refused = await signIn.json().catch(() => null);
      if (refused?.twoFactorRequired) return commandFailure(ctx, label, 'COSSACK_CMS_TWO_FACTOR_REQUIRED', `This account signs in with a second factor. Run cossack cms login --url ${origin} (or set COSSACK_CMS_TOKEN); the command then uses that application password.`);
      const failure = signInFailure(new CmsApiError(signIn.status, refused));
      if (failure.code === 'COSSACK_CMS_BOT_CHECK' || failure.code === 'COSSACK_CMS_SECOND_FACTOR_REQUIRED') return commandFailure(ctx, label, failure.code, failure.message);
      return commandFailure(ctx, label, 'COSSACK_PLUGIN_COMMAND_UNAUTHENTICATED', refused?.error ? `Sign-in failed: ${refused.error}` : 'Sign-in failed. Check the email, CMS_PASSWORD and URL.');
    }
  }
  let response;
  let body;
  try {
    const headers = { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', accept: 'application/json' };
    if (usePassword) headers.cookie = cookies.join('; ');
    else headers.authorization = `Bearer ${token}`;
    response = await fetch(`${origin}/api/cms/commands/${plugin}/${command.name}`, { method: 'POST', headers, body: JSON.stringify({ input: parsed.values }) });
    body = await response.json().catch(() => ({}));
  } finally {
    // A password session exists for this one command: end it rather than leave it signed in.
    if (usePassword) await fetch(`${origin}/api/auth/session`, { method: 'DELETE', redirect: 'manual', headers: { origin, 'sec-fetch-site': 'same-origin', cookie: cookies.join('; ') } }).catch(() => {});
  }
  if (!response.ok && body?.code === 'CMS_SECOND_FACTOR_REQUIRED') {
    const failure = signInFailure(new CmsApiError(response.status, body));
    return commandFailure(ctx, label, failure.code, failure.message);
  }
  if (!response.ok) return commandFailure(ctx, label, `COSSACK_PLUGIN_COMMAND_${response.status}`, body.error ?? `The command failed with HTTP ${response.status}.`);
  if (json) writeResult(label, { data: { result: body.result } });
  else console.log(typeof body.result === 'string' ? body.result : JSON.stringify(body.result, null, 2));
  return 0;
}

function parseOptions(argv, command) {
  const values = {};
  const problems = [];
  let url;
  let email;
  let allowHttp = false;
  const options = command.options ?? {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith('--')) { problems.push(`Unexpected argument ${argument}.`); continue; }
    const [flag, inline] = argument.slice(2).split(/=(.*)/s, 2);
    const take = () => inline ?? argv[++index];
    if (flag === 'url') { url = take(); continue; }
    if (flag === 'email') { email = take(); continue; }
    // The CLI's own flag, as on every `cossack cms` command: plain HTTP to a development host.
    if (flag === 'allow-http' && inline === undefined) { allowHttp = true; continue; }
    const rule = options[flag];
    if (!rule) { problems.push(`--${flag} is not an option of ${command.name}.`); continue; }
    if (rule.type === 'boolean') { values[flag] = inline === undefined ? true : inline === 'true'; continue; }
    const value = take();
    if (value === undefined) { problems.push(`--${flag} needs a value.`); continue; }
    if (rule.type === 'number') {
      if (!Number.isFinite(Number(value))) problems.push(`--${flag} must be a number.`);
      else values[flag] = Number(value);
    } else values[flag] = value;
  }
  for (const [name, rule] of Object.entries(options)) if (rule.required && values[name] === undefined) problems.push(`--${name} is required.`);
  return { values, problems, url, email, allowHttp };
}

async function readEnvironment(root) {
  const values = {};
  for (const file of ['.env', '.dev.vars']) {
    const text = await fs.readFile(path.join(root, file), 'utf8').catch(() => '');
    for (const line of text.split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match && values[match[1]] === undefined) values[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
    }
  }
  return values;
}
