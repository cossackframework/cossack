import { commandSpecs } from '../command-specs.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import prompts from 'prompts';
import {
  resolvePageTarget,
  resolveFileTarget,
  toKebab,
} from '../names.js';
import { exists, findProjectRoot, removeIfEmptyDir } from '../fs-utils.js';

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

import { createCommandOutput, runWithSpec } from '../command-spec.js';

const spec = commandSpecs.delete;

export async function deleteCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, () => {
    ctx.out = createCommandOutput(ctx);
    return deleteCommandInner(args, ctx);
  });
}

async function deleteCommandInner(args, ctx) {
  const [typeArg, nameArg] = args;
  const type = TYPE_ALIASES[typeArg];

  if (!type) {
    throw Object.assign(
      new Error(`Unknown delete type: ${typeArg}. Valid: page(p) component(c) layout(l) middleware(m) service(s)`),
      { code: 'COSSACK_DELETE_TYPE_UNKNOWN' },
    );
  }
  if (!nameArg) {
    throw Object.assign(
      new Error(`Missing name. Usage: cossack delete ${typeArg} <name>`),
      { code: 'COSSACK_ARGUMENT_MISSING' },
    );
  }

  const root = await findProjectRoot(ctx.cwd);

  // Resolve candidate target(s)
  const candidates = resolveCandidates(type, nameArg, root);
  const existing = [];
  for (const c of candidates) {
    if (await exists(c)) existing.push(c);
  }
  if (existing.length === 0) {
    throw Object.assign(new Error(`No ${type} files found for "${nameArg}".`), { code: 'COSSACK_FILE_NOT_FOUND' });
  }

  // Confirm unless --force / --dry-run / non-interactive
  if (!ctx.force && !ctx.dryRun && ctx.flags.json !== true && process.stdin.isTTY) {
    const { ok } = await prompts({
      type: 'confirm',
      name: 'ok',
      message: `Delete ${existing.length} file(s)?`,
      initial: false,
    });
    if (!ok) {
      ctx.out.line('  cancelled');
      return ctx.out.data({ status: 'cancelled' });
    }
  }

  if (ctx.dryRun) {
    for (const f of existing) ctx.out.file('planned-delete', f);
    return ctx.out.data({ status: 'dry-run' });
  }

  for (const f of existing) {
    await fs.rm(f, { force: true });
    ctx.out.file('deleted', f);
    // try to clean up a now-empty page directory
    const dir = path.dirname(f);
    if (type === 'page' || type === 'layout') {
      await removeIfEmptyDir(dir);
    }
  }
  return ctx.out.data({ status: 'deleted' });
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
  return commandSpecs.delete.help(`cossack delete <type> <name>   (alias: d)

Delete a generated page/component/layout/middleware/service.

Types: page(p) component(c) layout(l) middleware(m) service(s)`);
}
