/**
 * Where `cossack cms login` keeps application passwords: one JSON file in the user's config
 * directory, readable by the user alone, with a login per CMS address (and site, for site
 * accounts). `COSSACK_CONFIG_DIR` moves the directory, for tests and sandboxes.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const LOGINS_FILE = 'cms-logins.json';

export function configDirectory(env = process.env) {
  return env.COSSACK_CONFIG_DIR || path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'cossack');
}

export function loginsPath(env = process.env) {
  return path.join(configDirectory(env), LOGINS_FILE);
}

/** The key of a login: the address's origin, and `#<site>` for a site account. */
export function loginKey(url, site) {
  return `${new URL(url).origin}${site ? `#${site}` : ''}`;
}

/** The stored logins: `{ version, current, logins: { [key]: { url, site, token, email, name, user, scope, createdAt } } }`. */
export async function readLogins(env = process.env) {
  const file = loginsPath(env);
  let parsed;
  try { parsed = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return { version: 1, current: null, logins: {} };
    throw Object.assign(new Error(`Cannot read ${file}: ${error.message}`), { code: 'COSSACK_CMS_LOGINS_UNREADABLE' });
  }
  if (!parsed || typeof parsed !== 'object' || parsed.version !== 1 || typeof parsed.logins !== 'object') {
    throw Object.assign(new Error(`${file} is not a cossack logins file.`), { code: 'COSSACK_CMS_LOGINS_UNREADABLE' });
  }
  return { version: 1, current: typeof parsed.current === 'string' ? parsed.current : null, logins: parsed.logins ?? {} };
}

/** Write the logins file for the user alone (0600 in a 0700 directory), replacing it atomically. */
export async function writeLogins(store, env = process.env) {
  const file = loginsPath(env);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify({ version: 1, current: store.current ?? null, logins: store.logins }, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
  return file;
}

export async function rememberLogin(entry, env = process.env) {
  const store = await readLogins(env);
  const key = loginKey(entry.url, entry.site);
  store.logins[key] = { ...entry, url: new URL(entry.url).origin, site: entry.site ?? null, createdAt: entry.createdAt ?? new Date().toISOString() };
  store.current = key;
  return { key, file: await writeLogins(store, env) };
}

export async function forgetLogin(key, env = process.env) {
  const store = await readLogins(env);
  const entry = store.logins[key];
  delete store.logins[key];
  if (store.current === key) store.current = Object.keys(store.logins)[0] ?? null;
  await writeLogins(store, env);
  return entry;
}
