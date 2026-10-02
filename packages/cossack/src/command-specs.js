/**
 * Built-in command contracts. Parsing, preflight validation, and help all use
 * these definitions; lifecycle commands explicitly forward their raw argv.
 */
import { CommandSpec } from './command-spec.js';
import {
  ADAPTERS, FEATURES, AUTH_METHODS, OAUTH_PROVIDERS, UI_THEMES,
  DASHBOARD_MODULES, DATABASE_PROVIDERS, PRESET_REGISTRY,
} from '@cossackframework/scaffold/registry';

const bool = (description, extra = {}) => ({ type: 'boolean', description, repeated: 'last', ...extra });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const choices = (description, values, extra = {}) => str(description, { choices: values, ...extra });
const list = (description, values) => choices(description, values, { list: true, repeated: true });
const database = choices('Database provider.', Object.keys(DATABASE_PROVIDERS), { aliases: ['dialect'] });
const yes = bool('Accept defaults without prompting.', { aliases: ['y'] });
const env = str('Application/Cloudflare environment.');
const commonDatabase = {
  config: str('ORM config path (default: orm.config.ts).'), env,
  target: choices('Database target (default: local).', ['local', 'remote']),
  local: bool('Select the local database.'), remote: bool('Select the remote database.'),
};
const mutations = ['force', 'dry-run', 'json', 'help'];
const readonly = ['json', 'help'];
const dbGlobals = ['dry-run', 'json', 'help'];
const createFlags = {
  adapter: choices('Web runtime adapter.', ADAPTERS),
  'package-manager': choices('Package manager.', ['npm', 'pnpm', 'yarn', 'bun', 'deno']),
  preset: choices('Application preset.', Object.keys(PRESET_REGISTRY)),
  features: list('Application features, comma separated.', FEATURES),
  database: { ...database, aliases: [] },
  'auth-methods': list('Authentication methods, comma separated.', AUTH_METHODS),
  oauth: list('OAuth providers, comma separated.', OAUTH_PROVIDERS),
  theme: choices('UI theme.', UI_THEMES),
  'dashboard-features': list('Dashboard modules, comma separated.', DASHBOARD_MODULES),
  yes,
};

function targetDiagnostics(_args, flags) {
  if (flags.local === true && flags.remote === true ||
      flags.local === true && flags.target === 'remote' ||
      flags.remote === true && flags.target === 'local') {
    return [{ code: 'COSSACK_OPTION_CONFLICT', severity: 'error',
      message: 'Select one database target using --target, --local, or --remote.' }];
  }
  return [];
}
function providerDiagnostics(_args, flags) {
  const runtime = flags.adapter ?? flags.runtime;
  if (runtime && flags.database && !DATABASE_PROVIDERS[flags.database]?.adapters.includes(runtime)) {
    return [{ code: 'COSSACK_TARGET_INCOMPATIBLE', severity: 'error',
      message: 'The database provider does not support the selected runtime.' }];
  }
  return [];
}
function localeDiagnostics(args, flags) {
  const locale = args[1] ?? flags.locale;
  const errors = [];
  if (args[0] === 'add' && !locale) errors.push({ code: 'COSSACK_ARGUMENT_MISSING',
    severity: 'error', message: 'Supply a locale positional argument or --locale.' });
  if (args[1] && flags.locale && args[1] !== flags.locale) errors.push({
    code: 'COSSACK_OPTION_CONFLICT', severity: 'error', message: 'The locale argument conflicts with --locale.' });
  if (locale && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(locale)) errors.push({
    code: 'COSSACK_LOCALE_INVALID', severity: 'error', message: 'Use a locale code such as en, es, or zh-Hant.' });
  return errors;
}

export const commandSpecs = {
  create: new CommandSpec({ name: 'create', positionals: ['project-name'], minPositionals: 1,
    globals: mutations, flags: createFlags, check: providerDiagnostics }),
  deploy: new CommandSpec({ name: 'deploy', globals: ['json', 'help'], flags: {
    env, mode: str('Vite build mode.'),
    'dry-run': bool('Build and validate locally; writes build artifacts without uploading.'),
  } }),
  generate: new CommandSpec({ name: 'generate', aliases: ['g'], globals: mutations,
    positionals: ['type', 'name'], minPositionals: 2, flags: {
      head: bool('Generate a head() method.', { when: ['page', 'p'] }),
      title: str('Page title.', { when: ['page', 'p'] }),
      description: str('Page description.', { when: ['page', 'p'] }),
      'no-index': bool('Disable search indexing.', { aliases: ['ni'], when: ['page', 'p'] }),
    } }),
  delete: new CommandSpec({ name: 'delete', aliases: ['d'], globals: mutations,
    positionals: ['type', 'name'], minPositionals: 2 }),
  add: new CommandSpec({ name: 'add', globals: mutations,
    positionals: ['feature', 'component'], minPositionals: 1, flags: {
      theme: createFlags.theme, database, oauth: createFlags.oauth,
      'auth-methods': createFlags['auth-methods'],
      runtime: choices('Web runtime adapter.', ADAPTERS),
      features: { ...list('Dashboard modules, comma separated.', DASHBOARD_MODULES), when: ['dashboard'] }, yes,
    }, check: (args, flags) => [
      ...providerDiagnostics(args, flags),
      ...(args[1] && args[0] !== 'ui' ? [{ code: 'COSSACK_ARGUMENT_UNEXPECTED', severity: 'error',
        message: 'A component argument is only supported by add ui.' }] : []),
    ] }),
  remove: new CommandSpec({ name: 'remove', globals: mutations, positionals: ['feature'],
    minPositionals: 1, flags: { yes } }),
  adapter: new CommandSpec({ name: 'adapter', globals: mutations, positionals: ['adapter'],
    minPositionals: 1, flags: { database, yes },
    check: (args, flags) => providerDiagnostics(args, { ...flags, adapter: args[0] }) }),
  lang: new CommandSpec({ name: 'lang', globals: mutations, positionals: ['subcommand', 'locale'],
    minPositionals: 1, flags: { locale: str('Locale code (publish default: en).') },
    subcommands: { publish: { positionals: [] }, init: { positionals: [] }, add: { positionals: ['locale'] } },
    check: localeDiagnostics }),
  migration: new CommandSpec({ name: 'migration', aliases: ['migrate'], globals: dbGlobals,
    positionals: ['subcommand', 'name'], minPositionals: 1, flags: commonDatabase,
    subcommands: {
      generate: { positionals: ['name'], flags: { output: str('Migration output path.'),
        'allow-destructive': bool('Allow destructive diff operations.') } },
      snapshot: { flags: { force: bool('Replace the model snapshot.') } },
      squash: { positionals: ['name'], flags: { output: str('Migration output path.'),
        prune: bool('Replace the migration files and barrel.') } },
      up: {}, latest: {}, down: {}, status: {}, check: {}, baseline: {},
      plan: { flags: { direction: choices('Plan direction (default: up).', ['up', 'down']) } },
    }, check: targetDiagnostics }),
  seeder: new CommandSpec({ name: 'seeder', aliases: ['seed'], globals: dbGlobals,
    positionals: ['subcommand'], minPositionals: 1, flags: commonDatabase,
    subcommands: { run: { flags: { only: str('Seeder names, comma separated.') } }, list: {} },
    check: targetDiagnostics }),
  schema: new CommandSpec({ name: 'schema', globals: dbGlobals,
    positionals: ['subcommand'], minPositionals: 1, flags: commonDatabase,
    subcommands: {
      pull: { flags: { output: str('Generated model output path.'), force: bool('Replace generated models.') } },
      diff: { flags: { 'allow-destructive': bool('Allow destructive diff operations.') } },
      check: { flags: { 'allow-destructive': bool('Allow destructive diff operations.') } },
    }, check: targetDiagnostics }),
  studio: new CommandSpec({ name: 'studio', globals: ['dry-run', 'json', 'help'], flags: {
    port: str('Loopback port (1–65535).'), remote: bool('Use remote D1.'), database: str('Database binding/name.'),
    driver: choices('Database driver.', ['d1', 'sqlite', 'turso', 'postgres', 'mysql', 'hyperdrive-postgres', 'hyperdrive-mysql']),
    env, 'no-open': bool('Do not open the browser.'), timeout: str('JSON startup deadline in milliseconds.'),
  }, check: (_args, flags) => flags.remote === true && flags.driver && flags.driver !== 'd1'
    ? [{ code: 'COSSACK_TARGET_INCOMPATIBLE', severity: 'error', message: '--remote requires the D1 driver.' }] : [] }),
  inspect: new CommandSpec({ name: 'inspect', globals: readonly, positionals: ['scope', 'route'],
    minPositionals: 1, subcommands: {
      cloudflare: { flags: { env } },
      routes: { positionals: ['route'], flags: { verbose: bool('Include route details.') } },
    } }),
  check: new CommandSpec({ name: 'check', globals: readonly, positionals: ['scope'],
    minPositionals: 1, subcommands: { cloudflare: { flags: { env } } } }),
  routes: new CommandSpec({ name: 'routes', globals: readonly, flags: { verbose: bool('Include route details.') } }),
  info: new CommandSpec({ name: 'info', globals: readonly }),
  version: new CommandSpec({ name: 'version', aliases: ['v'], globals: readonly }),
  upgrade: new CommandSpec({ name: 'upgrade', globals: mutations, positionals: ['dir'], flags: {
    force: bool('Apply safe template updates and restore deleted owned files; preserve edits.', { aliases: ['f'] }),
    yes, tag: str('Dependency release tag (default: latest).'),
    'force-file': str('Owned file to replace; repeat for multiple files.', { repeated: true }),
    'apply-template': bool('Apply template changes while preserving edited files.'),
  } }),
  image: new CommandSpec({ name: 'image', globals: ['dry-run', 'json', 'help'],
    positionals: ['subcommand'], minPositionals: 1, subcommands: { optimize: {} }, flags: {
      format: choices('Output format (default: webp).', ['webp', 'avif']),
      quality: str('Output quality (0–100; default: 80).'),
    } }),
};
for (const name of ['dev', 'build', 'start', 'ssg']) {
  commandSpecs[name] = new CommandSpec({ name, globals: readonly, forwardsArgs: true });
}
export const inspectRoutesSpec = new CommandSpec({
  name: 'inspect', globals: readonly, positionals: ['route'],
  flags: { verbose: bool('Include route details.') },
});
