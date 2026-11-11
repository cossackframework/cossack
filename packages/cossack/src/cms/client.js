/**
 * The HTTP client behind `cossack cms`: one application password, one address, and the site
 * the commands act on (`X-Cossack-Site`). Answers are JSON; refusals become coded errors the
 * CLI prints or puts in its envelope.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { findProjectRoot } from '../fs-utils.js';
import { loginKey, readLogins } from './logins.js';

const CODES = { 400: 'COSSACK_CMS_INVALID', 401: 'COSSACK_CMS_UNAUTHENTICATED', 403: 'COSSACK_CMS_FORBIDDEN', 404: 'COSSACK_CMS_NOT_FOUND', 409: 'COSSACK_CMS_CONFLICT', 422: 'COSSACK_CMS_INVALID', 428: 'COSSACK_CMS_INVALID', 503: 'COSSACK_CMS_UNAVAILABLE' };

export class CmsApiError extends Error {
  constructor(status, body, fallback) {
    const fields = body && typeof body === 'object' && body.fields && typeof body.fields === 'object' ? body.fields : null;
    const detail = fields ? ' ' + Object.entries(fields).map(([field, problem]) => `${field} ${problem}`).join(' ') : '';
    super(`${(body && typeof body === 'object' && typeof body.error === 'string' ? body.error : fallback || `The CMS answered HTTP ${status}.`)}${detail}`);
    this.name = 'CmsApiError';
    this.status = status;
    this.code = CODES[status] ?? `COSSACK_CMS_HTTP_${status}`;
    this.cmsCode = body && typeof body === 'object' && typeof body.code === 'string' ? body.code : null;
    this.fields = fields;
    this.body = body && typeof body === 'object' ? body : null;
  }
}

/** A client for one address. `token` may be absent for sign-in requests, which carry cookies instead. */
export function createClient({ url, token, site, fetch = globalThis.fetch }) {
  const origin = new URL(url).origin;
  return {
    origin, site: site ?? null,
    /**
     * Send a request and parse its JSON. `query` drops undefined values; `body` is sent as JSON,
     * `form` as multipart; `cookie` and `headers` add to the request. 204 answers null.
     */
    async request(method, pathname, { query, body, form, headers = {}, cookie } = {}) {
      const target = new URL(pathname, origin);
      for (const [name, value] of Object.entries(query ?? {})) if (value !== undefined && value !== null && value !== '') target.searchParams.set(name, String(value));
      const sent = new Headers({ accept: 'application/json', ...headers });
      if (token) sent.set('authorization', `Bearer ${token}`);
      if (site) sent.set('x-cossack-site', site);
      if (cookie) { sent.set('cookie', cookie); sent.set('origin', origin); sent.set('sec-fetch-site', 'same-origin'); }
      if (body !== undefined) sent.set('content-type', 'application/json');
      let response;
      try { response = await fetch(target, { method, headers: sent, redirect: 'manual', body: body !== undefined ? JSON.stringify(body) : form }); }
      catch (error) { throw Object.assign(new Error(`Cannot reach ${origin}: ${error?.cause?.message ?? error?.message ?? error}`), { code: 'COSSACK_CMS_UNREACHABLE' }); }
      const text = await response.text();
      let parsed = null;
      if (text) { try { parsed = JSON.parse(text); } catch { parsed = null; } }
      if (!response.ok) throw new CmsApiError(response.status, parsed, parsed === null && text ? `The CMS answered HTTP ${response.status}: ${text.slice(0, 200)}` : undefined);
      return { data: parsed, response };
    },
  };
}

/** A variable from the project's `.env` or `.dev.vars`, when the working directory is in a project. */
export async function projectEnv(cwd, name) {
  let root;
  try { root = await findProjectRoot(cwd); } catch { return undefined; }
  for (const file of ['.env', '.dev.vars']) {
    const text = await fs.readFile(path.join(root, file), 'utf8').catch(() => '');
    const match = new RegExp(`^${name}=(.*)$`, 'm').exec(text);
    if (match) return match[1].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return undefined;
}

/** `APP_URL` from the project's `.env` or `.dev.vars`, when the working directory is in a project. */
export async function projectUrl(cwd) {
  const value = await projectEnv(cwd, 'APP_URL');
  return value && /^https?:\/\//.test(value) ? value : undefined;
}

/** Whether an address is this machine, where plain HTTP and a project's own `.env` address are fine. */
export function isLocalAddress(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return false; }
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** Whether plain HTTP to another machine was allowed: `--allow-http` or `COSSACK_CMS_ALLOW_HTTP=1`. */
export function httpAllowed(flags = {}, env = process.env) {
  return flags['allow-http'] === true || env.COSSACK_CMS_ALLOW_HTTP === '1';
}

/**
 * Refuse sending credentials where they could leak: over plain HTTP to another machine (unless
 * `allowHttp`, for development hosts such as `myapp.test` or a LAN address), or from the shell
 * environment to an address that only the current folder's `.env` named. A cloned project could
 * set `APP_URL` to any host; `--url` or `COSSACK_CMS_URL` confirms it.
 */
export function assertCredentialTarget(url, { source, credential, fromEnvironment = true, allowHttp = false }) {
  if (new URL(url).protocol !== 'https:' && !isLocalAddress(url) && !allowHttp) {
    throw Object.assign(new Error(`${new URL(url).origin} is plain HTTP. Use an https:// address; credentials are not sent unencrypted. For a development host, pass --allow-http (or set COSSACK_CMS_ALLOW_HTTP=1).`), { code: 'COSSACK_CMS_URL_INSECURE' });
  }
  if (source === 'project' && fromEnvironment && !isLocalAddress(url)) {
    throw Object.assign(new Error(`${credential} is not sent to ${new URL(url).origin}, which only this folder's .env names. Pass --url ${new URL(url).origin} (or set COSSACK_CMS_URL) to confirm.`), { code: 'COSSACK_CMS_URL_UNCONFIRMED' });
  }
}

/**
 * Where a command acts and as whom. The address: `--url`, `COSSACK_CMS_URL`, the project's
 * `APP_URL`, then the current login. The site: `--site`, `COSSACK_CMS_SITE`, then the login's.
 * The password: `COSSACK_CMS_TOKEN`, then the login for the address and site, or the address's
 * network login, which works on every site its account belongs to. `COSSACK_CMS_TOKEN` goes to
 * a project's `APP_URL` only when it is local or confirmed ({@link assertCredentialTarget}).
 */
export async function resolveTarget({ flags = {}, env = process.env, cwd = process.cwd(), needToken = true } = {}) {
  const store = await readLogins(env);
  const current = store.current ? store.logins[store.current] : undefined;
  const only = Object.keys(store.logins).length === 1 ? Object.values(store.logins)[0] : undefined;
  let url;
  let source;
  if (flags.url) { url = flags.url; source = 'flag'; }
  else if (env.COSSACK_CMS_URL) { url = env.COSSACK_CMS_URL; source = 'env'; }
  else if ((url = await projectUrl(cwd))) source = 'project';
  else { url = current?.url || only?.url; source = 'login'; }
  if (!url) throw Object.assign(new Error('Which CMS? Pass --url, set COSSACK_CMS_URL, or run cossack cms login from the project.'), { code: 'COSSACK_CMS_URL_REQUIRED' });
  try { url = new URL(url).origin; } catch { throw Object.assign(new Error(`${url} is not a URL.`), { code: 'COSSACK_CMS_URL_INVALID' }); }
  const site = flags.site || env.COSSACK_CMS_SITE || ((current?.url === url && current.site) || undefined) || undefined;
  if (site !== undefined && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(site)) throw Object.assign(new Error('--site is a site ID, such as blog or main.'), { code: 'COSSACK_CMS_SITE_INVALID' });
  const siteKey = loginKey(url, site === 'main' ? undefined : site);
  const loginAt = store.logins[siteKey] ? siteKey : store.logins[loginKey(url, undefined)] ? loginKey(url, undefined) : null;
  const login = loginAt ? store.logins[loginAt] : undefined;
  const token = env.COSSACK_CMS_TOKEN || login?.token;
  if (needToken && !token) throw Object.assign(new Error(`Not signed in to ${url}${site ? ` (site ${site})` : ''}. Run cossack cms login --url ${url}${site ? ` --site ${site}` : ''}, or set COSSACK_CMS_TOKEN.`), { code: 'COSSACK_CMS_LOGIN_REQUIRED' });
  const allowHttp = httpAllowed(flags, env);
  if (needToken) assertCredentialTarget(url, { source, credential: 'COSSACK_CMS_TOKEN', fromEnvironment: Boolean(env.COSSACK_CMS_TOKEN), allowHttp });
  // `key` names the stored login in use (the site's, or the address's network login), not the site's slot.
  return { url, source, allowHttp, site: site === 'main' ? undefined : site, token, login: login ?? null, key: loginAt ?? siteKey };
}

/** The ID an application password carries in front of its secret, for revoking it. */
export function tokenId(token) {
  return /^cms_([A-Za-z0-9_-]{16})\./.exec(token ?? '')?.[1] ?? null;
}
