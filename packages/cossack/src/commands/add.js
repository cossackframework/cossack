import fs from 'node:fs/promises';
import path from 'node:path';
import prompts from 'prompts';
import {
  writeFile,
  exists,
  readJsonIfExists,
  findProjectRoot,
} from '../fs-utils.js';
import { resolvePackageVersion } from '../pkg.js';
import {
  authLayoutTemplate,
  loginPageTemplate,
  registerPageTemplate,
  forgotPasswordPageTemplate,
  resetPasswordPageTemplate,
  authMiddlewareTemplate,
  rootLayoutWithAuthTemplate,
  sessionModelTemplate,
  authModuleTemplate,
  userModelTemplate,
  dbConfigD1Template,
  dbConfigTursoTemplate,
  dbMiddlewareFileTemplate,
  createUsersMigration,
  createSessionsMigration,
  createRolesMigration,
  createPermissionsMigration,
  createOauthAccountsMigration,
  createCacheTableMigration,
  seederTemplate,
  UI_COMPONENTS,
  uiBarrelTemplate,
} from '../templates.js';
import { flagList, flagString } from '../flags.js';
import { resolveFileTarget } from '../names.js';

const FEATURES = {
  auth: addAuth,
  database: addDatabase,
  ui: addUi,
};

export async function addCommand(args, ctx) {
  const [feature, ...rest] = args;
  const fn = FEATURES[feature];
  if (!fn) {
    console.error(
      `Unknown feature: ${feature || '(none)'}.\nAvailable features: ${Object.keys(FEATURES).join(', ')}`,
    );
    return 1;
  }
  return fn(rest, ctx);
}

const SUPPORTED_OAUTH_PROVIDERS = ['github', 'google', 'gitlab', 'facebook', 'microsoft'];

/**
 * Resolve the auth route group from --path, or default to (auth).
 * Returns the directory name and the public route paths.
 */
async function resolveAuthPaths(ctx) {
  const flag = flagString(ctx.flags.path) || flagString(ctx.flags.p);
  const group = flag && flag.length ? flag : '(auth)';
  // Public route paths: strip route-group segments for the URL (route groups are
  // filesystem-only). e.g. "(auth)" -> "/login", "admin/(auth)" -> "/admin/login".
  const urlPrefix = group
    .split('/')
    .filter(Boolean)
    .filter((segment) => !/^\(.+\)$/.test(segment))
    .join('/');
  const base = urlPrefix ? `/${urlPrefix}` : '';
  return {
    group,
    pagesDir: `src/pages/${group}`,
    loginPath: `${base}/login`,
    registerPath: `${base}/register`,
    forgotPasswordPath: `${base}/forgot-password`,
    resetPasswordPath: `${base}/reset-password`,
  };
}

/** Resolve OAuth providers from --oauth (comma-list/repeatable) or an interactive prompt. */
async function resolveOauthProviders(ctx) {
  const raw = ctx.flags.oauth;
  let list = [];
  if (raw === true) {
    // bare --oauth: prompt
    if (ctx.dryRun) return ['github'];
    const resp = await prompts(
      {
        type: 'multiselect',
        name: 'providers',
        message: 'Which OAuth providers?',
        choices: SUPPORTED_OAUTH_PROVIDERS.map((p) => ({
          title: p.charAt(0).toUpperCase() + p.slice(1),
          value: p,
        })),
      },
      { onCancel: () => process.exit(1) },
    );
    list = resp.providers ?? [];
  } else if (raw) {
    list = flagList(raw)
      .flatMap((v) => String(v).split(','))
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  }
  const invalid = list.filter((p) => !SUPPORTED_OAUTH_PROVIDERS.includes(p));
  if (invalid.length) {
    console.error(
      `  error   Unknown OAuth provider(s): ${invalid.join(', ')}. Supported: ${SUPPORTED_OAUTH_PROVIDERS.join(', ')}`,
    );
    process.exit(1);
  }
  return list;
}

async function addAuth(_args, ctx) {
  const root = await findProjectRoot(ctx.cwd);

  // 0. resolve options
  const paths = await resolveAuthPaths(ctx);
  const oauthProviders = await resolveOauthProviders(ctx);
  const publicPaths = [
    paths.loginPath,
    paths.registerPath,
    paths.forgotPasswordPath,
    paths.resetPasswordPath,
  ];

  // 1. ensure database support (auth needs users + sessions tables)
  if (!(await exists(path.resolve(root, 'src/db/config.ts')))) {
    const dialect = (await resolveDialect(ctx));
    console.log('  adding database support (required by auth)...');
    await ensureDatabase(root, { dialect, ctx });
  }

  // 2. add auth dependency
  await addDependency(root, '@cossackframework/auth', resolveAuthVersion(), ctx);

  // 2b. ensure UI package (the generated pages import from @cossackframework/ui)
  if (!resolvePackageVersion('@cossackframework/ui')) {
    console.log('  adding ui support (used by the auth pages)...');
  }
  await ensureUi(root, ctx);

  // 3. scaffold auth module + session model + pages + middleware
  const files = [
    ['src/models/Session.ts', sessionModelTemplate()],
    ['src/auth.ts', authModuleTemplate({ publicPaths, loginPath: paths.loginPath, oauthProviders })],
    [`${paths.pagesDir}/layout.ts`, authLayoutTemplate()],
    [`${paths.pagesDir}/login/index.ts`, loginPageTemplate({ loginPath: paths.loginPath, registerPath: paths.registerPath, oauthProviders })],
    [`${paths.pagesDir}/register/index.ts`, registerPageTemplate({ loginPath: paths.loginPath })],
    [`${paths.pagesDir}/forgot-password/index.ts`, forgotPasswordPageTemplate({ loginPath: paths.loginPath })],
    [`${paths.pagesDir}/reset-password/index.ts`, resetPasswordPageTemplate({ loginPath: paths.loginPath })],
    ['src/middlewares/auth.ts', authMiddlewareTemplate({ publicPaths, loginPath: paths.loginPath })],
  ];

  for (const [rel, content] of files) {
    const target = path.resolve(root, rel);
    const result = await writeFile(target, content, ctx);
    reportFile(rel, result, ctx);
  }

  // 4. register global middleware (auth session + guard) in
  //    src/bootstrap/middlewares.ts (the registry createApp auto-loads).
  await registerMiddleware(root, {
    importLine: "import { auth } from '../auth';\nimport { authGuard } from '../middlewares/auth';",
    entry: '  auth.middleware,\n  authGuard,',
    marker: 'authGuard',
    label: 'auth',
    ctx,
  });

  // 5. wire the send_email binding into wrangler.jsonc (for password-reset emails)
  await wireSendEmailBinding(root, ctx);

  // 6. ensure a root layout exists (renders children; middleware is centralized)
  await ensureRootLayout(root, ctx);

  console.log(
    `\nAuth added. Routes: ${paths.loginPath}, ${paths.registerPath}, ${paths.forgotPasswordPath}, ${paths.resetPasswordPath}\n` +
      'Next:\n' +
      '  1. Run `pnpm install`.\n' +
      '  2. Apply migrations: `cossack migration up`.\n' +
      (oauthProviders.length
        ? `  3. Set OAUTH_SECRET + provider credentials (${oauthProviders.map((p) => p.toUpperCase() + '_CLIENT_ID/SECRET').join(', ')}) in .dev.vars,\n     and mount the oauth redirect/callback routes in src/index.ts.`
        : ''),
  );
  return 0;
}

async function ensureRootLayout(root, ctx) {
  const target = path.resolve(root, 'src/pages/layout.ts');
  if (await exists(target)) {
    console.log('  exists   src/pages/layout.ts (auth middleware is registered in src/bootstrap/middlewares.ts)');
    return;
  }
  const result = await writeFile(target, rootLayoutWithAuthTemplate(), ctx);
  reportFile('src/pages/layout.ts', result, ctx);
}

/**
 * Inject a `send_email` binding into wrangler.jsonc for password-reset emails.
 * Idempotent: skips if a `send_email` block exists.
 */
async function wireSendEmailBinding(root, ctx) {
  const target = path.resolve(root, 'wrangler.jsonc');
  if (!(await exists(target))) {
    console.log('  note     No wrangler.jsonc found (Node-adapter project?). Email binding skipped.');
    return;
  }
  let content;
  try {
    content = await fs.readFile(target, 'utf8');
  } catch {
    return;
  }
  if (/"send_email"\s*:/.test(content)) {
    console.log('  exists   send_email binding already in wrangler.jsonc');
    return;
  }
  const block =
    '\n  // Cloudflare Email Routing. Used by env.EMAIL.send(...) for password-reset\n' +
    '  // (and any transactional email). Verify the `from` domain in the dashboard.\n' +
    '  "send_email": [\n' +
    '    {\n' +
    '      "name": "EMAIL"\n' +
    '    }\n' +
    '  ],';
  const replaced = content.replace(/^(\s*\{)/m, `$1${block}`);
  if (replaced === content) {
    console.log('  note     Could not locate insertion point in wrangler.jsonc');
    return;
  }
  if (ctx.dryRun) {
    console.log('  would add  send_email binding to wrangler.jsonc');
    return;
  }
  await fs.writeFile(target, replaced, 'utf8');
  console.log('  added    send_email binding (EMAIL) to wrangler.jsonc');
}

// ---------------------------------------------------------------------------
// `cossack add database`
// ---------------------------------------------------------------------------

/** Resolve the dialect from --dialect=<d1|turso> or an interactive prompt. */
async function resolveDialect(ctx) {
  const flag = ctx.flags?.dialect || ctx.flags?.d;
  if (flag === 'd1' || flag === 'turso') return flag;
  if (ctx.dryRun) return 'd1'; // non-interactive default for dry runs
  const { dialect } = await prompts(
    {
      type: 'select',
      name: 'dialect',
      message: 'Which database dialect?',
      choices: [
        { title: 'Cloudflare D1 (recommended)', value: 'd1' },
        { title: 'Turso (libSQL)', value: 'turso' },
      ],
      initial: 0,
    },
    { onCancel: () => process.exit(1) },
  );
  return dialect;
}

async function addDatabase(_args, ctx) {
  const root = await findProjectRoot(ctx.cwd);
  const dialect = await resolveDialect(ctx);
  await ensureDatabase(root, { dialect, ctx });
  console.log(
    `\nDatabase support added (dialect: ${dialect}).\n` +
      'Next:\n' +
      '  1. Run `pnpm install`.' +
      (dialect === 'd1'
        ? '\n  2. Create a D1 database: `npx wrangler d1 create <name>` and paste\n     the database_id into the [[d1_databases]] block in wrangler.jsonc.'
        : '\n  2. Set TURSO_URL / TURSO_TOKEN (e.g. in .dev.vars).') +
      '\n  3. Apply migrations: `cossack migration up`.\n' +
      '  4. Query via `db()` in any server method, or `getDb(c)` in API routes.',
  );
  return 0;
}

/**
 * Scaffold database support (deps, models, migrations, config, middleware).
 * Extracted from `addDatabase` so `addAuth` can reuse it. Idempotent — each
 * `writeFile` skips files that already exist (pass `ctx.force` to overwrite).
 */
async function ensureDatabase(root, { dialect, ctx }) {
  // 1. dependencies
  await addDependency(root, '@cossackframework/database', resolveDatabaseVersion(), ctx);
  if (dialect === 'turso') {
    await addDependency(root, '@tursodatabase/serverless', resolveTursoVersion(), ctx);
  }

  // 2. scaffold models + migrations + seeders + db config
  const migrations = [
    ['0001_create_users.ts', createUsersMigration()],
    ['0002_create_sessions.ts', createSessionsMigration()],
    ['0003_create_roles.ts', createRolesMigration()],
    ['0004_create_permissions.ts', createPermissionsMigration()],
    ['0005_create_oauth_accounts.ts', createOauthAccountsMigration()],
    ['0006_create_cache_table.ts', createCacheTableMigration()],
  ];

  const files = [
    ['src/models/User.ts', userModelTemplate()],
    ['src/seeders/database.seeder.ts', seederTemplate()],
    ['src/middlewares/db.ts', dbMiddlewareFileTemplate()],
    [
      'src/db/config.ts',
      dialect === 'd1' ? dbConfigD1Template() : dbConfigTursoTemplate(),
    ],
    ...migrations.map(([rel, content]) => [`src/migrations/${rel}`, content]),
  ];

  for (const [rel, content] of files) {
    const target = path.resolve(root, rel);
    const result = await writeFile(target, content, ctx);
    reportFile(rel, result, ctx);
  }

  // 3. wire D1 binding into wrangler.jsonc (D1 only)
  if (dialect === 'd1') {
    await wireD1Binding(root, ctx);
  }

  // 4. register the db middleware in src/bootstrap/middlewares.ts (the registry
  //    createApp auto-loads). Clean append — no src/index.ts surgery.
  await registerMiddleware(root, {
    importLine: "import { dbMiddleware } from '../middlewares/db';",
    entry: '  dbMiddleware,',
    marker: 'dbMiddleware',
    label: 'db',
    ctx,
  });
}

/**
 * Ensure the @cossackframework/ui package is available: add the dependency,
 * write the src/components/ui barrel, and wire the theme imports into
 * src/style.css. Idempotent — safe to call from addAuth (which now generates
 * pages that import from the UI package) even when `cossack add ui` was already
 * run. Mirrors the dependency-ensure pattern of ensureDatabase().
 */
async function ensureUi(root, ctx) {
  // 1. dependency
  await addDependency(root, '@cossackframework/ui', resolveUiVersion(), ctx);

  // 2. barrel re-export (same file addUi writes)
  const barrelPath = path.resolve(root, 'src/components/ui/index.ts');
  const barrelResult = await writeFile(barrelPath, uiBarrelTemplate(), ctx);
  reportFile('src/components/ui/index.ts', barrelResult, ctx);

  // 3. theme imports into src/style.css (idempotent via the marker check inside)
  await wireUiTheme(root, ctx);
}

function resolveTursoVersion() {
  const installed = resolvePackageVersion('@tursodatabase/serverless');
  return installed ? `^${installed}` : '^0.1.0';
}

/**
 * Inject a `[[d1_databases]]` binding into wrangler.jsonc (D1 only).
 * The database_id is a placeholder — the user replaces it after running
 * `wrangler d1 create`. Idempotent: skips if a `d1_databases` block exists.
 */
async function wireD1Binding(root, ctx) {
  const target = path.resolve(root, 'wrangler.jsonc');
  if (!(await exists(target))) {
    console.log(
      '  note     No wrangler.jsonc found (Node-adapter project?). Skip this step.',
    );
    return;
  }
  let content;
  try {
    content = await fs.readFile(target, 'utf8');
  } catch {
    return;
  }
  if (/"d1_databases"\s*:/.test(content)) {
    console.log('  exists   d1_databases binding already in wrangler.jsonc');
    return;
  }
  const block =
    '\n  // Cloudflare D1 binding. Replace <database_id> with the output of\n' +
    '  // `npx wrangler d1 create <name>`, then run `cossack migration up`.\n' +
    '  "d1_databases": [\n' +
    '    {\n' +
    '      "binding": "DB",\n' +
    '      "database_name": "app-db",\n' +
    '      "database_id": "<database_id>"\n' +
    '    }\n' +
    '  ],';
  // Insert before the first top-level key (after the opening brace).
  const replaced = content.replace(/^(\s*\{)/m, `$1${block}`);
  if (replaced === content) {
    console.log('  note     Could not locate insertion point in wrangler.jsonc');
    return;
  }
  if (ctx.dryRun) {
    console.log('  would add  d1_databases binding to wrangler.jsonc');
    return;
  }
  await fs.writeFile(target, replaced, 'utf8');
  console.log('  added    d1_databases binding (DB) to wrangler.jsonc');
  console.log('  reminder  replace <database_id> after `npx wrangler d1 create <name>`');
}

/**
 * Wire `dbMiddleware` into the app entry (src/index.ts). Best-effort:
 * if the file uses `createApp({`, inject the import + option; otherwise
 * print guidance.
 */
/**
 * Register a middleware in `src/bootstrap/middlewares.ts` (the registry
 * `createApp()` auto-loads). Clean, idempotent append to a small, stable
 * file — far more robust than editing the user's `src/index.ts`.
 *
 * - File absent → create it with the import + a one-entry array.
 * - File present, marker already referenced → skip.
 * - File present, marker missing → add the import after the last import line
 *   and the entry after the array's opening `[`.
 *
 * @param root       project root
 * @param importLine full `import { x } from '...'` line (with trailing \n)
 * @param entry      the array entry, e.g. `'  dbMiddleware,'`
 * @param marker     substring used to detect prior registration (e.g. `'dbMiddleware'`)
 * @param label      human label for log lines
 */
async function registerMiddleware(root, { importLine, entry, marker, label, ctx }) {
  const target = path.resolve(root, 'src/bootstrap/middlewares.ts');

  if (!(await exists(target))) {
    const content =
      "import type { MiddlewareHandler } from 'hono';\n" +
      importLine +
      '\nconst middlewares: MiddlewareHandler[] = [\n' +
      entry +
      '\n];\n\nexport default middlewares;\n';
    if (ctx.dryRun) {
      console.log(`  would create  src/bootstrap/middlewares.ts (with ${label})`);
      return;
    }
    await writeFile(target, content, ctx);
    console.log(`  created  src/bootstrap/middlewares.ts (registered ${label})`);
    return;
  }

  let content;
  try {
    content = await fs.readFile(target, 'utf8');
  } catch {
    return;
  }
  if (content.includes(marker)) {
    console.log(`  exists   src/bootstrap/middlewares.ts already registers ${label}`);
    return;
  }

  let updated = content;
  // Add the import after the last existing import line.
  const lastImportIdx = updated.lastIndexOf('import');
  if (lastImportIdx !== -1) {
    const lineEnd = updated.indexOf('\n', lastImportIdx) + 1;
    updated = updated.slice(0, lineEnd) + importLine + updated.slice(lineEnd);
  } else {
    updated = importLine + updated;
  }
  // Insert the entry right after the array's opening bracket.
  if (!/\[/.test(updated)) {
    console.log(
      `  note     src/bootstrap/middlewares.ts has no array — add ${label} manually.`,
    );
    return;
  }
  updated = updated.replace('[', `[\n${entry}`);

  if (ctx.dryRun) {
    console.log(`  would register  ${label} in src/bootstrap/middlewares.ts`);
    return;
  }
  await fs.writeFile(target, updated, 'utf8');
  console.log(`  registered  ${label} in src/bootstrap/middlewares.ts`);
}

function reportFile(rel, result, ctx) {
  switch (result) {
    case 'wrote':
      console.log(`  created  ${rel}`);
      break;
    case 'overwrote':
      console.log(`  overwrite ${rel}`);
      break;
    case 'dry-run':
      console.log(`  would create  ${rel}`);
      break;
    case 'skipped':
      console.log(`  exists   ${rel} (use --force to overwrite)`);
      break;
  }
}

async function addDependency(root, name, version, ctx) {
  const pkgPath = path.resolve(root, 'package.json');
  const pkg = await readJsonIfExists(pkgPath);
  if (!pkg) {
    console.error('  error   no package.json found (is this a Cossack project?)');
    return;
  }
  pkg.dependencies = pkg.dependencies || {};
  if (pkg.dependencies[name]) {
    console.log(`  exists   ${name} already in dependencies (${pkg.dependencies[name]})`);
    return;
  }
  if (ctx.dryRun) {
    console.log(`  would add  ${name}@${version} to package.json`);
    return;
  }
  pkg.dependencies[name] = version;
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`  added    ${name}@${version} to package.json`);
}

function resolveAuthVersion() {
  const installed = resolvePackageVersion('@cossackframework/auth');
  if (installed) return `^${installed}`;
  const fw = resolvePackageVersion('@cossackframework/framework');
  if (fw) return `^${fw}`;
  return '^0.5.0';
}

function resolveDatabaseVersion() {
  const installed = resolvePackageVersion('@cossackframework/database');
  if (installed) return `^${installed}`;
  const fw = resolvePackageVersion('@cossackframework/framework');
  if (fw) return `^${fw}`;
  return '^0.1.0';
}

function resolveUiVersion() {
  const installed = resolvePackageVersion('@cossackframework/ui');
  if (installed) return `^${installed}`;
  const fw = resolvePackageVersion('@cossackframework/framework');
  if (fw) return `^${fw}`;
  return '^0.1.0';
}

// ---------------------------------------------------------------------------
// `cossack add ui` / `cossack add ui <component>`
// ---------------------------------------------------------------------------

const UI_THEME_MARKER = '@cossackframework/ui/theme';

/** Palettes that can be selected via `cossack add ui --theme=<name>`. */
const UI_PALETTES = [
  'neutral', 'zinc', 'stone', 'gray', 'slate',
  'blue', 'green', 'red',
];

/**
 * Build the CSS block appended to src/style.css by `cossack add ui`.
 *
 * - Two @import lines pull the base reset + @theme token layer.
 * - An optional palette @import (when `palette` is set) retints the UI.
 * - Two @source lines tell Tailwind v4 to scan the package's component/icon
 *   source. Tailwind v4 excludes node_modules by default, so without these the
 *   variant utilities (bg-secondary, bg-destructive, bg-success, ...) would
 *   never be generated and the components would render unstyled.
 */
function uiThemeBlock(palette) {
  const lines = [
    `@import "@cossackframework/ui/theme/base.css";`,
    `@import "@cossackframework/ui/theme/theme.css";`,
  ];
  if (palette) {
    lines.push(
      `@import "@cossackframework/ui/theme/themes/${palette}.css";`,
    );
  }
  lines.push(
    ``,
    `@source "../node_modules/@cossackframework/ui/src/components";`,
    `@source "../node_modules/@cossackframework/ui/src/icons";`,
  );
  return lines.join('\n');
}

/**
 * Wire the @cossackframework/ui CSS imports + @source directives into the
 * project's src/style.css. Idempotent (skips if the marker is present),
 * dryRun-aware. Mirrors the registerMiddleware string-surgery style: if there's
 * no style.css yet, synthesize a minimal one.
 */
async function wireUiTheme(root, ctx, palette) {
  const target = path.resolve(root, 'src/style.css');
  const block = uiThemeBlock(palette);
  const fullBlock = `@import "tailwindcss";\n${block}\n`;

  if (!(await exists(target))) {
    const result = await writeFile(target, fullBlock, ctx);
    reportFile('src/style.css', result, ctx);
    return;
  }

  const content = await fs.readFile(target, 'utf8');
  if (content.includes(UI_THEME_MARKER)) {
    console.log('  exists   src/style.css (ui theme already imported)');
    return;
  }
  if (ctx.dryRun) {
    console.log('  would edit  src/style.css (insert ui theme imports + @source)');
    return;
  }

  // Inject the ui block right after @import "tailwindcss"; so theme tokens load
  // before any app overrides. If there's no tailwindcss import, prepend the
  // whole block (including the tailwind import) — a Cossack app always needs it.
  let updated;
  if (/^\s*@import\s+["']tailwindcss["'];?\s*$/m.test(content)) {
    updated = content.replace(
      /(@import\s+["']tailwindcss["'];?\s*\n)/,
      `$1${block}\n`,
    );
  } else {
    updated = `${fullBlock}\n${content}`;
  }
  await fs.writeFile(target, updated, 'utf8');
  console.log('  edited  src/style.css (added ui theme imports + @source)');
}

/**
 * `cossack add ui` — adds the @cossackframework/ui dependency, a
 * src/components/ui barrel re-exporting from the package, and wires the two
 * CSS @import lines into src/style.css. Consumers then import from the package.
 *
 * `cossack add ui <component>` — ejects a single customizable copy of the
 * named component into src/components/ui/<Component>.ts. The user owns it.
 */
async function addUi(args, ctx) {
  const root = await findProjectRoot(ctx.cwd);
  const [component] = Array.isArray(args) ? args : [];

  await addDependency(root, '@cossackframework/ui', resolveUiVersion(), ctx);

  // Barrel re-export so `import { Button } from './components/ui'` works
  // whether or not individual components are ejected.
  const barrelPath = path.resolve(root, 'src/components/ui/index.ts');
  const barrelResult = await writeFile(barrelPath, uiBarrelTemplate(), ctx);
  reportFile('src/components/ui/index.ts', barrelResult, ctx);

  if (component) {
    const key = String(component).toLowerCase();
    const entry = UI_COMPONENTS[key];
    if (!entry) {
      console.error(
        `Unknown UI component: ${component}.\nAvailable components: ${Object.keys(UI_COMPONENTS).join(', ')}`,
      );
      return 1;
    }
    const target = resolveFileTarget(component, 'components/ui', { pascal: true });
    const fileAbs = path.resolve(root, `${target.full}.ts`);
    const result = await writeFile(fileAbs, entry.template(), ctx);
    reportFile(`${target.full}.ts`, result, ctx);

    console.log(
      `\nUI component ejected: ${target.file}.ts\n` +
        'You now own this file — edit it freely. Re-run with --force to overwrite.\n' +
        'Next:\n  1. Run `pnpm install`.',
    );
    return 0;
  }

  // No component arg: wire the global theme imports.
  const palette = flagString(ctx.flags.theme) || flagString(ctx.flags.t);
  if (palette && !UI_PALETTES.includes(palette)) {
    console.error(
      `Unknown theme: ${palette}.\nAvailable themes: ${UI_PALETTES.join(', ')}`,
    );
    return 1;
  }
  await wireUiTheme(root, ctx, palette);

  console.log(
    '\nUI support added. Components are available via `import { Button, ... } from "./components/ui"`.\n' +
      (palette ? `Theme: ${palette} (wired into src/style.css).\n` : '') +
      'Next:\n  1. Run `pnpm install`.\n' +
      '  2. Confirm the @import lines are present in src/style.css.\n' +
      '  3. (Optional) Eject a component for customization: `cossack add ui button`.',
  );
  return 0;
}

export function addHelp() {
  return `cossack add <feature>

Add a feature to the current project.

Features:
  auth      Adds @cossackframework/auth + full working session auth: PBKDF2 password
            hashing, a createAuth() module (src/auth.ts), Session model, real
            login/register/forgot-password/reset-password pages (validated forms with
            @Server methods), an auth guard middleware, and registers everything in
            src/bootstrap/middlewares.ts. Also ensures database support (D1/Turso) and
            wires the send_email binding for password-reset emails.
            Routes default to (auth)/{login,register,forgot-password,reset-password}.
  database  Adds @cossackframework/database (Kysely + D1/Turso dialects), a default
            User model, starter migrations (users, sessions, roles, permissions,
            oauth_accounts, cache_items), a seeder, src/db/config.ts, and registers
            the dbMiddleware in src/bootstrap/middlewares.ts. Prompts for the dialect
            (default: D1). Note: database support is included by default in new
            projects — use this only to add it to an existing project that predates it.
  ui        Adds @cossackframework/ui (token-driven, themeable components + Solar
            icons), a src/components/ui barrel, and wires the base.css + theme.css
            @import lines into src/style.css. Components are then importable from
            "./components/ui". Pass a component name to eject a customizable copy:
            \`cossack add ui button\` writes src/components/ui/Button.ts that you own.
            Use --theme to select a color palette (neutral families retint the
            whole surface scale; accent palettes retint the primary/ring/chart):
            \`cossack add ui --theme=blue\`. Default is the shadcn neutral.
            Themes: neutral, zinc, stone, gray, slate, blue, green, red.

Options:
  --force, -f              Overwrite existing files.
  --theme=<name>           (ui) Color palette: neutral, zinc, stone, gray, slate, blue, green, red.
  --dialect=<d1|turso>     Skip the database dialect prompt (used by both features).
  --path <route-group>     (auth) Custom route group, e.g. --path admin/auth.
  --oauth <providers>      (auth) OAuth providers: github,google,gitlab,facebook,microsoft.
                           Comma-separated or repeated. Bare --oauth prompts interactively.`;
}
