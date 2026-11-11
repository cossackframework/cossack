/**
 * `cossack cms login`, `logout`, `whoami` and `mcp`: signing in with email and password (and a
 * second-factor code) to create an application password, keeping it, and handing it to MCP
 * clients. The password itself is printed only by `mcp`, which exists to configure a client.
 */
import os from 'node:os';
import { assertCredentialTarget, CmsApiError, createClient, resolveTarget, tokenId } from './client.js';
import { forgetLogin, rememberLogin } from './logins.js';

const coded = (code, message) => Object.assign(new Error(message), { code });

/** Ask in the terminal; nothing to ask without one. */
async function terminalAsk({ type, message }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;
  const { default: prompts } = await import('prompts');
  const answer = await prompts({ type, name: 'value', message }, { onCancel: () => { throw coded('COSSACK_COMMAND_ABORTED', 'Canceled.'); } });
  return answer.value;
}

export async function loginCommand({ flags, env = process.env, cwd = process.cwd(), out = () => {}, ask = terminalAsk, fetch = globalThis.fetch }) {
  const target = await resolveTarget({ flags, env, cwd, needToken: false });
  const { url, site } = target;
  let token = flags.token;
  let name = flags.name;
  const scope = flags.scope ?? 'write';
  if (!token) {
    const email = flags.email || env.CMS_EMAIL || await ask({ type: 'text', message: 'Email' });
    const password = env.CMS_PASSWORD || await ask({ type: 'password', message: 'Password' });
    if (!email || !password) throw coded('COSSACK_CMS_CREDENTIALS_REQUIRED', 'Pass --email and set CMS_PASSWORD (or run in a terminal to be asked).');
    assertCredentialTarget(url, { source: target.source, credential: 'CMS_PASSWORD', fromEnvironment: Boolean(env.CMS_PASSWORD), allowHttp: target.allowHttp });
    const session = createClient({ url, site, fetch });
    const sameOrigin = { origin: session.origin, 'sec-fetch-site': 'same-origin' };
    let code = flags.code;
    let cookie;
    for (;;) {
      try {
        const { response } = await session.request('POST', '/api/auth/session', { body: { email, password, ...(code ? { code } : {}) }, headers: sameOrigin });
        cookie = response.headers.getSetCookie().map(entry => entry.split(';')[0]).filter(Boolean).join('; ');
        break;
      } catch (error) {
        if (error instanceof CmsApiError && error.status === 401 && error.body?.twoFactorRequired && !code) {
          code = await ask({ type: 'text', message: 'Code from your authenticator app' });
          if (code) continue;
          throw coded('COSSACK_CMS_TWO_FACTOR_REQUIRED', 'This account signs in with a second factor: pass --code <code> from the authenticator app.');
        }
        if (error instanceof CmsApiError && error.status === 401) throw coded('COSSACK_CMS_SIGN_IN_FAILED', 'Sign-in failed. Check the email, the password and the address.');
        throw error;
      }
    }
    if (!cookie) throw coded('COSSACK_CMS_SIGN_IN_FAILED', 'Sign-in gave no session.');
    name ||= `cossack CLI (${os.hostname()})`;
    const created = await session.request('POST', '/api/cms/me/tokens', { body: { name, scope, ...(flags.expires ? { expiresInDays: Number(flags.expires) } : {}) }, cookie });
    token = created.data.token;
    // The session did its job; the application password signs in from now on.
    await session.request('DELETE', '/api/auth/session', { cookie }).catch(() => undefined);
  } else {
    // A typed token still goes only where the address was confirmed, and never over plain HTTP.
    assertCredentialTarget(url, { source: target.source, credential: '--token', allowHttp: target.allowHttp });
  }
  const me = (await createClient({ url, site, token, fetch }).request('GET', '/api/cms/me')).data;
  name ||= `application password ${tokenId(token) ?? ''}`.trim();
  const { file } = await rememberLogin({ url, site, token, tokenId: tokenId(token), name, scope: me.token?.scope ?? scope, email: me.user.email, user: me.user.id }, env);
  const roles = me.user.roles.map(role => role.name).join(', ') || (me.user.networkAdmin ? 'network admin' : 'no roles');
  out(`Signed in to ${url}${site ? ` (site ${site})` : ''} as ${me.user.email} (${roles}).`);
  out(`Application password "${name}" (${me.token?.scope ?? scope}) stored in ${file}.`);
  return { url, site: me.site, user: me.user, token: { id: tokenId(token), name, scope: me.token?.scope ?? scope }, file };
}

export async function logoutCommand({ flags, env = process.env, cwd = process.cwd(), out = () => {}, fetch = globalThis.fetch }) {
  // Forgetting a stored login sends nothing, so it works for any address; revoking sends the
  // password, so only where it may go.
  const target = await resolveTarget({ flags, env, cwd, needToken: false });
  // Logging out ends the stored login: its password is the one revoked and forgotten. A
  // `COSSACK_CMS_TOKEN` from the shell is revoked only when no login is stored for the target.
  const stored = target.login?.token;
  const token = stored || env.COSSACK_CMS_TOKEN;
  if (!token) throw coded('COSSACK_CMS_LOGIN_REQUIRED', `Not signed in to ${target.url}${target.site ? ` (site ${target.site})` : ''}.`);
  const id = tokenId(token);
  let revoked = false;
  let kept;
  try { assertCredentialTarget(target.url, { source: target.source, credential: stored ? 'the stored application password' : 'COSSACK_CMS_TOKEN', fromEnvironment: !stored, allowHttp: target.allowHttp }); }
  catch (error) { kept = error; }
  if (id && !kept) {
    try { await createClient({ url: target.url, site: target.site, token, fetch }).request('DELETE', `/api/cms/me/tokens/${id}`); revoked = true; }
    catch (error) { if (!(error instanceof CmsApiError)) throw error; }
  }
  const forgotten = target.login ? Boolean(await forgetLogin(target.key, env)) : false;
  if (kept && !forgotten) throw kept;
  out(`${revoked ? 'Revoked the application password and signed' : 'Signed'} out of ${target.url}${target.site ? ` (site ${target.site})` : ''}.`);
  if (kept) out(`The application password was not revoked: ${kept.message} Revoke it in the dashboard under your profile.`);
  return { url: target.url, site: target.site ?? null, revoked, forgotten };
}

export async function whoamiCommand({ flags, env = process.env, cwd = process.cwd(), out = () => {}, fetch = globalThis.fetch }) {
  const target = await resolveTarget({ flags, env, cwd });
  const me = (await createClient({ ...target, fetch }).request('GET', '/api/cms/me')).data;
  const roles = me.user.roles.map(role => role.name).join(', ') || (me.user.networkAdmin ? 'network admin' : 'no roles');
  out(`${me.user.email} (${roles}) on ${me.site.name || me.site.id} (${me.site.id}) at ${target.url}${me.token ? `, with a ${me.token.scope} application password` : ''}.`);
  return me;
}

/** The MCP client configuration for the login: the site's endpoint and the stored application password, as a JSON block or a `claude mcp add` command. */
export async function mcpCommand({ flags, env = process.env, cwd = process.cwd(), out = () => {} }) {
  const target = await resolveTarget({ flags, env, cwd });
  const endpoint = `${target.url}/api/cms/mcp${target.site ? `?site=${encodeURIComponent(target.site)}` : ''}`;
  const name = flags.name || `cms-${new URL(target.url).hostname.replaceAll(/[^a-z0-9]+/gi, '-')}${target.site ? `-${target.site}` : ''}`.toLowerCase();
  const config = { mcpServers: { [name]: { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${target.token}` } } } };
  const command = `claude mcp add --transport http ${name} ${JSON.stringify(endpoint)} --header ${JSON.stringify(`Authorization: Bearer ${target.token}`)}`;
  out(flags.format === 'claude' ? command : JSON.stringify(config, null, 2));
  return { name, url: endpoint, config, command };
}
