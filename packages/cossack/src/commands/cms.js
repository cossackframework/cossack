/**
 * `cossack cms <noun> <verb>`: manage a running CMS site through its management API, as the
 * dashboard's user would, with an application password `cossack cms login` keeps. Every command
 * acts on one address (`--url`) and site (`--site`), prints a table or JSON, and under `--json`
 * returns the API's answer in the envelope.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { commandSpecs } from '../command-specs.js';
import { runWithSpec } from '../command-spec.js';
import { CMS_COMMANDS, findCommand, NOUNS } from '../cms/catalog.js';
import { createClient, resolveTarget } from '../cms/client.js';
import { readBody } from '../cms/input.js';
import { loginCommand, logoutCommand, mcpCommand, whoamiCommand } from '../cms/login.js';
import { mimeType } from '../cms/mime.js';
import { formatJson, formatTable } from '../cms/output.js';

const spec = commandSpecs.cms;
const coded = (code, message) => Object.assign(new Error(message), { code });

export function cmsHelp() {
  const lines = [];
  for (const noun of NOUNS) {
    const commands = CMS_COMMANDS.filter(command => command.noun === noun);
    for (const command of commands) {
      const usage = `${noun}${command.verb ? ` ${command.verb}` : ''}${command.positionals.length ? ' ' + command.positionals.map(name => `<${name}>`).join(' ') : ''}`;
      lines.push(`  ${usage.padEnd(44)} ${command.summary}`);
    }
  }
  return spec.help(`cossack cms <command> [args] [options]

Manage a CMS site through its API, as a signed-in user. Start with \`cossack cms login --url https://example.com\`
(email from --email or CMS_EMAIL, password from CMS_PASSWORD or a prompt); it stores an application password
for the address under ~/.config/cossack/. In a project, the address defaults to the APP_URL of .env.
COSSACK_CMS_URL, COSSACK_CMS_TOKEN and COSSACK_CMS_SITE override the stored login, for CI.
On a network, --site <id> acts on one site (site accounts sign in with --site too).
Writes take --data '{"title":"Hello"}' (or @file, @- for stdin) and --set title=Hello; deletes need --yes.
\`cossack cms mcp\` prints the configuration an MCP client needs for the same site.

Commands:
${lines.join('\n')}`);
}

export async function cmsCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
    const [noun, verb, ...rest] = args;
    const command = findCommand(noun, verb);
    const json = ctx.flags.json === true;
    const out = text => { if (!json) console.log(text); };
    const env = process.env;
    const options = { flags: ctx.flags, env, cwd: ctx.cwd, out };
    if (noun === 'login') return loginCommand(options);
    if (noun === 'logout') return logoutCommand(options);
    if (noun === 'whoami') return whoamiCommand(options);
    if (noun === 'mcp') return mcpCommand(options);
    const label = `cms ${noun} ${command.verb}`;
    if (command.destructive && ctx.flags.yes !== true) throw coded('COSSACK_CMS_CONFIRM_REQUIRED', `${label} is permanent: add --yes to confirm.`);
    const body = command.write ? await readBody(ctx.flags, { cwd: ctx.cwd }) : undefined;
    const request = command.request(rest, ctx.flags, body);
    const client = createClient(await resolveTarget({ flags: ctx.flags, env, cwd: ctx.cwd }));
    const data = await send(client, request, ctx.cwd);
    if (!json) await present(command, data, ctx);
    return data;
  }, cmsHelp);
}

/** Send a catalog request: read the entry's revision first when a write needs one, and build the form of an upload. */
async function send(client, request, cwd) {
  const query = { ...(request.query ?? {}) };
  let body = request.body;
  if (request.rev) {
    const rev = request.rev.given ?? (await client.request('GET', request.rev.read)).data?.item?.rev;
    if (!Number.isSafeInteger(rev) || rev < 1) throw coded('COSSACK_CMS_REVISION_UNKNOWN', 'Could not read the entry\'s current revision; pass --rev.');
    if (request.rev.where === 'query') query.rev = rev; else body = { ...body, rev };
  }
  let form;
  if (request.files) {
    if (!request.files.length) throw coded('COSSACK_ARGUMENT_MISSING', 'Name the files to upload.');
    form = new FormData();
    for (const file of request.files) {
      const target = path.resolve(cwd, file);
      let bytes;
      try { bytes = await fs.readFile(target); } catch (error) { throw coded('COSSACK_CMS_FILE_UNREADABLE', `Cannot read ${file}: ${error.message}`); }
      // The CMS classes a file by its media type, so the name's extension supplies one.
      form.append('file', new File([bytes], path.basename(target), { type: mimeType(target) }));
    }
  }
  return (await client.request(request.method, request.path, { query, body, form })).data;
}

async function present(command, data, ctx) {
  if (command.raw) {
    const text = formatJson(command.raw(data));
    if (ctx.flags.out) { await fs.writeFile(path.resolve(ctx.cwd, ctx.flags.out), `${text}\n`); console.log(`Wrote ${ctx.flags.out}.`); }
    else console.log(text);
    return;
  }
  if (data === null || data === undefined) { console.log('Done.'); return; }
  const rows = command.table ? command.table.rows(data) : null;
  if (rows) {
    console.log(formatTable(rows, command.table.columns));
    if (command.table.total && typeof data.total === 'number') console.log(`${data.total} in all${typeof data.pages === 'number' && data.pages > 1 ? `, page ${data.page} of ${data.pages}` : ''}.`);
    return;
  }
  console.log(formatJson(data));
}
