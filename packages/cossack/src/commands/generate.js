import path from 'node:path';
import {
  resolvePageTarget,
  resolveFileTarget,
  resolveMigrationTarget,
  toPascal,
  toKebab,
} from '../names.js';
import { writeFile, exists } from '../fs-utils.js';
import {
  pageTemplate,
  pageMdxTemplate,
  componentTemplate,
  layoutTemplate,
  middlewareTemplate,
  serviceTemplate,
  userModelTemplate,
  migrationTemplate,
  seederTemplate,
} from '../templates.js';

const TYPE_ALIASES = {
  page: 'page',
  p: 'page',
  component: 'component',
  c: 'component',
  layout: 'layout',
  l: 'layout',
  middleware: 'middleware',
  m: 'middleware',
  service: 'service',
  s: 'service',
  model: 'model',
  migration: 'migration',
  seeder: 'seeder',
};

export async function generateCommand(args, ctx) {
  const [typeArg, nameArg] = args;
  const type = TYPE_ALIASES[typeArg];

  if (!type) {
    console.error(
      `Unknown generate type: ${typeArg || '(none)'}.\nValid: page(p) component(c) layout(l) middleware(m) service(s) model migration seeder`,
    );
    return 1;
  }
  if (!nameArg) {
    console.error(`Missing name. Usage: cossack generate ${typeArg} <name>`);
    return 1;
  }

  const root = ctx.projectRoot || process.cwd();

  switch (type) {
    case 'page':
      return generatePage(nameArg, root, ctx);
    case 'component':
      return generateComponent(nameArg, root, ctx);
    case 'layout':
      return generateLayout(nameArg, root, ctx);
    case 'middleware':
      return generateMiddleware(nameArg, root, ctx);
    case 'service':
      return generateService(nameArg, root, ctx);
    case 'model':
      return generateModel(nameArg, root, ctx);
    case 'migration':
      return generateMigration(nameArg, root, ctx);
    case 'seeder':
      return generateSeeder(nameArg, root, ctx);
  }
  return 0;
}

async function generatePage(raw, root, ctx) {
  const t = resolvePageTarget(raw);
  const target = path.resolve(root, `${t.full}${t.ext}`);
  const title = toPascal(t.kebab || 'page');

  let content;
  if (t.ext === '.md' || t.ext === '.mdx') {
    content = pageMdxTemplate({ title });
  } else {
    content = pageTemplate({ className: t.className, title });
  }

  const result = await writeFile(target, content, ctx);
  return report(target, result, ctx);
}

async function generateComponent(raw, root, ctx) {
  const t = resolveFileTarget(raw, 'components', { pascal: true });
  const target = path.resolve(root, `${t.full}${t.ext}`);
  const className = toPascal(t.pascal || 'Component');
  const content = componentTemplate({ className, propsName: `${className}Props` });
  const result = await writeFile(target, content, ctx);
  return report(target, result, ctx);
}

async function generateLayout(raw, root, ctx) {
  // layout lives at src/pages/<name>/layout.ts (matches contact/layout.ts)
  const dirLeaf = toKebab(raw.split('/').pop());
  const segments = raw.split('/').filter(Boolean).slice(0, -1).map(toKebab);
  const dir = path.resolve(root, 'src/pages', ...segments, dirLeaf);
  const target = path.join(dir, 'layout.ts');
  const className = `${toPascal(dirLeaf)}Layout`;
  const content = layoutTemplate({ className, kebab: dirLeaf });
  const result = await writeFile(target, content, ctx);
  return report(target, result, ctx);
}

async function generateMiddleware(raw, root, ctx) {
  const t = resolveFileTarget(raw, 'middlewares', { pascal: false });
  const target = path.resolve(root, `${t.full}${t.ext}`);
  const exportName = `${t.camel}Middleware`;
  const content = middlewareTemplate({ exportName });
  const result = await writeFile(target, content, ctx);
  return report(target, result, ctx);
}

async function generateService(raw, root, ctx) {
  const t = resolveFileTarget(raw, 'services', { suffix: 'Service', pascal: true });
  const target = path.resolve(root, `${t.full}${t.ext}`);
  const className = `${toPascal(t.pascal)}Service`;
  const content = serviceTemplate({ className });
  const result = await writeFile(target, content, ctx);
  return report(target, result, ctx);
}

/** `cossack g model User` — scaffolds a typed model + Database/User augmentations. */
async function generateModel(raw, root, ctx) {
  const t = resolveFileTarget(raw, 'models', { pascal: true });
  const target = path.resolve(root, `${t.full}${t.ext}`);
  const content = userModelTemplate();
  const result = await writeFile(target, content, ctx);
  return report(target, result, ctx);
}

/** `cossack g migration create_users` — src/migrations/<timestamp>_create_users.ts */
async function generateMigration(raw, root, ctx) {
  const t = resolveMigrationTarget(raw);
  const target = path.resolve(root, t.full);
  const content = migrationTemplate();
  const result = await writeFile(target, content, ctx);
  return report(target, result, ctx);
}

/** `cossack g seeder users` — src/seeders/<kebab>.ts */
async function generateSeeder(raw, root, ctx) {
  const t = resolveFileTarget(raw, 'seeders', { pascal: false });
  const target = path.resolve(root, `${t.full}${t.ext}`);
  const content = seederTemplate();
  const result = await writeFile(target, content, ctx);
  return report(target, result, ctx);
}

function report(target, result, ctx) {
  const rel = path.relative(process.cwd(), target);
  switch (result) {
    case 'wrote':
      console.log(`  created  ${rel}`);
      return 0;
    case 'overwrote':
      console.log(`  overwrite ${rel}`);
      return 0;
    case 'dry-run':
      console.log(`  would create  ${rel}`);
      return 0;
    case 'skipped':
      console.error(`  exists   ${rel} (use --force to overwrite)`);
      return 1;
  }
  return 0;
}

export function generateHelp() {
  return `cossack generate <type> <name>   (alias: g)

Generate a page, component, layout, middleware, service, model, migration, or seeder.

Types:
  page (p), component (c), layout (l), middleware (m), service (s),
  model, migration, seeder

Examples:
  cossack g p my-page
  cossack g p /dashboard/my-page
  cossack g p my-page.md
  cossack g c UserWidget
  cossack g l dashboard
  cossack g m request-logger
  cossack g s counter
  cossack g model User
  cossack g migration create_posts
  cossack g seeder posts

Options:
  --force, -f   Overwrite an existing file.`;
}
