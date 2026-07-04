import fs from 'node:fs/promises';
import path from 'node:path';
import prompts from 'prompts';
import {
  resolvePageTarget,
  resolveFileTarget,
  toKebab,
} from '../names.js';
import { exists, removeIfEmptyDir } from '../fs-utils.js';

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
};

const PAGE_EXTS = ['.ts', '.md', '.mdx'];

export async function deleteCommand(args, ctx) {
  const [typeArg, nameArg] = args;
  const type = TYPE_ALIASES[typeArg];

  if (!type) {
    console.error(
      `Unknown delete type: ${typeArg || '(none)'}.\nValid: page(p) component(c) layout(l) middleware(m) service(s)`,
    );
    return 1;
  }
  if (!nameArg) {
    console.error(`Missing name. Usage: cossack delete ${typeArg} <name>`);
    return 1;
  }

  const root = ctx.projectRoot || process.cwd();

  // Resolve candidate target(s)
  const candidates = resolveCandidates(type, nameArg, root);
  const existing = [];
  for (const c of candidates) {
    if (await exists(c)) existing.push(c);
  }
  if (existing.length === 0) {
    console.error(`  not found  ${type} "${nameArg}"`);
    return 1;
  }

  // Confirm unless --force / --dry-run / non-interactive
  if (!ctx.force && !ctx.dryRun && process.stdin.isTTY) {
    const { ok } = await prompts({
      type: 'confirm',
      name: 'ok',
      message: `Delete ${existing.length} file(s)?`,
      initial: false,
    });
    if (!ok) {
      console.log('  cancelled');
      return 0;
    }
  }

  if (ctx.dryRun) {
    for (const f of existing) console.log(`  would delete  ${path.relative(process.cwd(), f)}`);
    return 0;
  }

  for (const f of existing) {
    await fs.rm(f, { force: true });
    console.log(`  deleted  ${path.relative(process.cwd(), f)}`);
    // try to clean up a now-empty page directory
    const dir = path.dirname(f);
    if (type === 'page' || type === 'layout') {
      await removeIfEmptyDir(dir);
    }
  }
  return 0;
}

function resolveCandidates(type, raw, root) {
  switch (type) {
    case 'page': {
      // Consider both directory-based (index.<ext>) and flat (<name>.<ext>)
      // page files so `delete` can remove whatever `generate` produced.
      const index = resolvePageTarget(raw);
      const flat = resolvePageTarget(raw, { noIndex: true });
      const out = [];
      for (const ext of PAGE_EXTS) {
        out.push(path.resolve(root, `${index.full}${ext}`));
        if (flat.full !== index.full) out.push(path.resolve(root, `${flat.full}${ext}`));
      }
      return out;
    }
    case 'component': {
      const t = resolveFileTarget(raw, 'components', { pascal: true });
      return [path.resolve(root, `${t.full}${t.ext}`)];
    }
    case 'layout': {
      const dirLeaf = toKebab(raw.split('/').pop());
      const segments = raw.split('/').filter(Boolean).slice(0, -1).map(toKebab);
      return [path.resolve(root, 'src/pages', ...segments, dirLeaf, 'layout.ts')];
    }
    case 'middleware': {
      const t = resolveFileTarget(raw, 'middlewares', { pascal: false });
      return [path.resolve(root, `${t.full}${t.ext}`)];
    }
    case 'service': {
      const t = resolveFileTarget(raw, 'services', { suffix: 'Service', pascal: true });
      return [path.resolve(root, `${t.full}${t.ext}`)];
    }
  }
  return [];
}

export function deleteHelp() {
  return `cossack delete <type> <name>   (alias: d)

Delete a generated page/component/layout/middleware/service.

Types: page(p) component(c) layout(l) middleware(m) service(s)

Options:
  --force, -f   Skip the confirmation prompt.`;
}
