import { commandSpecs } from '../command-specs.js';
import path from 'node:path';
import {
  resolvePageTarget,
  resolveFileTarget,
  resolveMigrationTarget,
  toPascal,
  toKebab,
  toTitle,
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

import { createCommandOutput, runWithSpec } from '../command-spec.js';

const spec = commandSpecs.generate;

export async function generateCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
    ctx.out = createCommandOutput(ctx);
    const code = await generateCommandInner(args, ctx);
    if (code === 0 && ctx.flags.json === true) {
      return ctx.out.data({ type: args[0], name: args[1] });
    }
    return code;
  });
}

async function generateCommandInner(args, ctx) {
  const [typeArg, nameArg] = args;
  const type = TYPE_ALIASES[typeArg];

  if (!type) {
    throw Object.assign(
      new Error(`Unknown generate type: ${typeArg}. Valid: page(p) component(c) layout(l) middleware(m) service(s) model migration seeder`),
      { code: 'COSSACK_GENERATE_TYPE_UNKNOWN' },
    );
  }
  if (!nameArg) {
    throw Object.assign(
      new Error(`Missing name. Usage: cossack generate ${typeArg} <name>`),
      { code: 'COSSACK_ARGUMENT_MISSING' },
    );
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
  const noIndex = ctx.flags?.['no-index'] === true || ctx.flags?.ni === true;
  const t = resolvePageTarget(raw, { noIndex });
  const target = path.resolve(root, `${t.full}${t.ext}`);
  const defaultTitle = toTitle(t.kebab || 'page');
  const flagTitle = ctx.flags?.title;
  const flagDescription = ctx.flags?.description;
  const title = typeof flagTitle === 'string' && flagTitle ? flagTitle : defaultTitle;
  const description =
    typeof flagDescription === 'string' && flagDescription ? flagDescription : defaultTitle;
  const withHead =
    ctx.flags?.head === true || flagTitle !== undefined || flagDescription !== undefined;

  let content;
  if (t.ext === '.md' || t.ext === '.mdx') {
    content = pageMdxTemplate({ title, description: flagDescription });
  } else {
    content = pageTemplate({ className: t.className, title, description, withHead });
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

/** `cossack g model Invoice` — scaffolds a decorated Active Record entity. */
async function generateModel(raw, root, ctx) {
  const t = resolveFileTarget(raw, 'models', { pascal: true });
  const target = path.resolve(root, `${t.full}${t.ext}`);
  const content = userModelTemplate({ className: toPascal(t.pascal) });
  const result = await writeFile(target, content, ctx);
  return report(target, result, ctx);
}

/** `cossack g migration create_users` — src/migrations/<timestamp>_create_users.ts */
async function generateMigration(raw, root, ctx) {
  const t = resolveMigrationTarget(raw);
  const target = path.resolve(root, t.full);
  const content = migrationTemplate({ name: t.kebab.replaceAll('-', '_') });
  const result = await writeFile(target, content, ctx);
  return report(target, result, ctx);
}

/** `cossack g seeder users` — src/seeders/<kebab>.ts */
async function generateSeeder(raw, root, ctx) {
  const t = resolveFileTarget(raw, 'seeders', { pascal: false });
  const target = path.resolve(root, `${t.full}${t.ext}`);
  const content = seederTemplate({ name: t.kebab });
  const result = await writeFile(target, content, ctx);
  return report(target, result, ctx);
}

function report(target, result, ctx) {
  const out = ctx.out ?? createCommandOutput(ctx);
  switch (result) {
    case 'wrote': return out.file('created', target);
    case 'overwrote': return out.file('overwritten', target);
    case 'dry-run': return out.file('planned', target);
    case 'skipped':
      // A blocking failure with a code: numeric-only results would emit an
      // envelope without diagnostics (CLI-03 review finding).
      out.file('skipped', target);
      throw Object.assign(
        new Error(`Refusing to overwrite ${path.relative(process.cwd(), target)}. Use --force to overwrite.`),
        { code: 'COSSACK_FILE_EXISTS' },
      );
  }
  return 0;
}

export function generateHelp() {
  return commandSpecs.generate.help(`cossack generate <type> <name>   (alias: g)

Generate a page, component, layout, middleware, service, model, migration, or seeder.

Types:
  page (p), component (c), layout (l), middleware (m), service (s),
  model, migration, seeder

Examples:
  cossack g p my-page
  cossack g p /dashboard/my-page
  cossack g p my-page.md
  cossack g p my-page --head                        # page with a head() method (SEO)
  cossack g p my-page --title "My Custom Title" \\
                       --description "Custom desc"  # custom head() values
  cossack g p hello --no-index                      # -> src/pages/hello.ts (flat file, no folder)
  cossack g c UserWidget
  cossack g l admin/dashboard                       # -> src/pages/admin/dashboard/layout.ts
  cossack g m request-logger
  cossack g s counter
  cossack g model User
  cossack g migration create_posts
  cossack g seeder posts`);
}
