/**
 * `cossack <plugin>:<command>`: commands declared in a rendered plugin manifest. Help and
 * options come from the manifest; the handler runs in the application, as a signed-in
 * dashboard user, behind the same permissions as the dashboard.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { findProjectRoot } from './fs-utils.js';
import { commandFailure, writeResult } from './output.js';

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
Set CMS_PASSWORD; the email comes from --email or CMS_EMAIL, the application from --url or APP_URL.

Options:
${[...options, '  --url <url>  Application URL.', '  --email <email>  Dashboard user.', '  --json  Emit versioned JSON.', '  --help  Show this help.'].join('\n')}`;
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
  const email = parsed.email ?? process.env.CMS_EMAIL;
  const password = process.env.CMS_PASSWORD;
  if (!url || !email || !password) return commandFailure(ctx, label, 'COSSACK_PLUGIN_COMMAND_CREDENTIALS', 'Set --url (or APP_URL), --email (or CMS_EMAIL) and CMS_PASSWORD.');
  const origin = new URL(url).origin;
  const signIn = await fetch(`${origin}/api/auth/session`, {
    method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const cookies = signIn.headers.getSetCookie().map(cookie => cookie.split(';')[0]).filter(Boolean);
  if (signIn.status !== 200 || !cookies.length) {
    return commandFailure(ctx, label, 'COSSACK_PLUGIN_COMMAND_UNAUTHENTICATED', 'Sign-in failed. Check the email, CMS_PASSWORD and URL.');
  }
  const response = await fetch(`${origin}/api/cms/commands/${plugin}/${command.name}`, {
    method: 'POST', headers: { origin, cookie: cookies.join('; '), 'content-type': 'application/json' },
    body: JSON.stringify({ input: parsed.values }),
  });
  const body = await response.json().catch(() => ({}));
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
  const options = command.options ?? {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith('--')) { problems.push(`Unexpected argument ${argument}.`); continue; }
    const [flag, inline] = argument.slice(2).split(/=(.*)/s, 2);
    const take = () => inline ?? argv[++index];
    if (flag === 'url') { url = take(); continue; }
    if (flag === 'email') { email = take(); continue; }
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
  return { values, problems, url, email };
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
