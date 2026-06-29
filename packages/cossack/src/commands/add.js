import fs from 'node:fs/promises';
import path from 'node:path';
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
  authMiddlewareTemplate,
  rootLayoutWithAuthTemplate,
} from '../templates.js';

const FEATURES = {
  auth: addAuth,
};

export async function addCommand(args, ctx) {
  const [feature] = args;
  const fn = FEATURES[feature];
  if (!fn) {
    console.error(
      `Unknown feature: ${feature || '(none)'}.\nAvailable features: ${Object.keys(FEATURES).join(', ')}`,
    );
    return 1;
  }
  return fn(ctx);
}

async function addAuth(ctx) {
  const root = await findProjectRoot(ctx.cwd);

  // 1. add dependency to package.json
  await addDependency(root, '@cossackframework/auth', ctx);

  // 2. scaffold route-group pages + layout under src/pages/(auth)/
  const files = [
    ['src/pages/(auth)/layout.ts', authLayoutTemplate()],
    ['src/pages/(auth)/login/index.ts', loginPageTemplate()],
    ['src/pages/(auth)/register/index.ts', registerPageTemplate()],
    ['src/pages/(auth)/forgot-password/index.ts', forgotPasswordPageTemplate()],
    ['src/middlewares/auth.ts', authMiddlewareTemplate()],
  ];

  for (const [rel, content] of files) {
    const target = path.resolve(root, rel);
    const result = await writeFile(target, content, ctx);
    reportFile(rel, result, ctx);
  }

  // 3. wire the middleware into the root layout (src/pages/layout.ts)
  await wireRootLayout(root, ctx);

  console.log(
    '\nAuth stub added. Resulting routes: /login, /register, /forgot-password\n' +
      'Next: install deps (`pnpm install`) and fill in the stubs in\n' +
      '  src/middlewares/auth.ts and the (auth) pages.',
  );
  return 0;
}

async function wireRootLayout(root, ctx) {
  const target = path.resolve(root, 'src/pages/layout.ts');
  if (await exists(target)) {
    // Already exists — don't clobber. Surface guidance instead.
    const existing = await fs.readFile(target, 'utf8');
    if (existing.includes('authMiddleware')) {
      console.log('  exists   src/pages/layout.ts already wires authMiddleware');
      return;
    }
    console.log(
      '  note     src/pages/layout.ts exists — to enable auth, import authMiddleware\n' +
        "           from '../middlewares/auth' and add it to @Page({ middlewares: [...], transport: 'http' }).",
    );
    return;
  }
  const result = await writeFile(target, rootLayoutWithAuthTemplate(), ctx);
  reportFile('src/pages/layout.ts', result, ctx);
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

async function addDependency(root, name, ctx) {
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
  const version = resolveAuthVersion();
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

export function addHelp() {
  return `cossack add <feature>

Add a feature to the current project.

Features:
  auth    Adds @cossackframework/auth, login/register/forgot-password page stubs,
          an (auth) route-group layout, an auth middleware, and wires it into
          src/pages/layout.ts.

Options:
  --force, -f   Overwrite existing stub files.`;
}
