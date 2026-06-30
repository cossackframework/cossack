/**
 * `cossack lang <subcommand>` — localization scaffolding.
 *
 *   cossack lang publish              Create src/lang/en.json with starter keys
 *   cossack lang add <locale>         Create src/lang/<locale>.json (empty values)
 *
 * Options:
 *   --locale=<code>   Use a different default locale for `publish` (default: en)
 *   --force, -f       Overwrite an existing file
 *   --dry-run         Print actions without writing
 */
import path from 'node:path';
import { writeFile, exists, findProjectRoot } from '../fs-utils.js';
import { flagString } from '../flags.js';
import { defaultLangCatalog, langJsonTemplate } from '../templates.js';

const DEFAULT_LOCALE = 'en';

export async function langCommand(args, ctx) {
  const [sub, ...rest] = args;
  if (sub === 'publish' || sub === 'init') {
    return publish(rest, ctx);
  }
  if (sub === 'add') {
    return addLocale(rest, ctx);
  }
  if (sub === '--help' || sub === '-h' || sub === 'help') {
    console.log(langHelp());
    return 0;
  }
  console.error(
    `Unknown lang subcommand: ${sub || '(none)'}.\n${langHelp()}`,
  );
  return 1;
}

/** `cossack lang publish` — create the default locale catalog. */
async function publish(args, ctx) {
  const { flags } = parseSimpleFlags(args, ctx);
  const locale = flagString(flags.locale) || DEFAULT_LOCALE;
  const root = await findProjectRoot(ctx.cwd);
  const target = path.resolve(root, 'src', 'lang', `${locale}.json`);

  // When publishing a non-default locale, seed it with empty values against
  // the English starter keys (so the catalog shape is consistent). If en.json
  // exists, mirror its keys; otherwise fall back to the built-in catalog.
  if (locale === DEFAULT_LOCALE) {
    const result = await writeFile(
      target,
      langJsonTemplate(defaultLangCatalog()),
      ctx,
    );
    reportFile(`src/lang/${locale}.json`, result);
    if (result !== 'skipped') {
      console.log(
        `\nLocalization enabled. Default locale: ${locale}.\n` +
          `Edit src/lang/${locale}.json, then use __('key') in any render().\n` +
          `Generate additional locales with \`cossack lang add <code>\`.`,
      );
    }
    return 0;
  }

  const entries = await seedEntries(root, locale);
  const result = await writeFile(target, langJsonTemplate(entries), ctx);
  reportFile(`src/lang/${locale}.json`, result);
  if (result !== 'skipped') {
    console.log(
      `\nCreated src/lang/${locale}.json from your ${DEFAULT_LOCALE} catalog.\n` +
        'Fill in the translations, then switch at runtime with setLocale(...).',
    );
  }
  return 0;
}

/** `cossack lang add <locale>` — create an empty locale catalog. */
async function addLocale(args, ctx) {
  const cleaned = args.filter((a) => !a.startsWith('-'));
  const { flags } = parseSimpleFlags(args, ctx);
  const locale = cleaned[0] || flagString(flags.locale);
  if (!locale) {
    console.error('Usage: cossack lang add <locale>   (e.g. `cossack lang add es`)');
    return 1;
  }
  if (locale === DEFAULT_LOCALE) {
    console.error(
      `Use \`cossack lang publish\` to create the default (${DEFAULT_LOCALE}) catalog.`,
    );
    return 1;
  }

  const root = await findProjectRoot(ctx.cwd);
  const target = path.resolve(root, 'src', 'lang', `${locale}.json`);
  if ((await exists(target)) && !ctx.force && !ctx.dryRun) {
    console.log(`  exists   src/lang/${locale}.json (use --force to overwrite)`);
    return 0;
  }

  const entries = await seedEntries(root, locale);
  const result = await writeFile(target, langJsonTemplate(entries), ctx);
  reportFile(`src/lang/${locale}.json`, result);
  return 0;
}

/**
 * Build empty-value entries for a new locale, mirroring the keys of an
 * existing catalog. Prefers the default (`en`) catalog if present; falls
 * back to the built-in starter catalog so the file is never empty.
 */
async function seedEntries(root, locale) {
  const defaultPath = path.resolve(root, 'src', 'lang', `${DEFAULT_LOCALE}.json`);
  if (await exists(defaultPath)) {
    try {
      const text = await (await import('node:fs/promises')).readFile(
        defaultPath,
        'utf8',
      );
      const parsed = JSON.parse(text);
      const seed = {};
      for (const key of Object.keys(parsed)) seed[key] = '';
      return seed;
    } catch {
      // fall through to default catalog
    }
  }
  const starter = defaultLangCatalog();
  const seed = {};
  for (const key of Object.keys(starter)) seed[key] = '';
  return seed;
}

function parseSimpleFlags(args, ctx) {
  // ctx already carries parsed flags for top-level options; combine with any
  // inline `--locale=xx` passed after the subcommand.
  const flags = { ...(ctx.flags || {}) };
  for (const tok of args) {
    if (typeof tok !== 'string') continue;
    if (tok.startsWith('--locale=')) {
      flags.locale = tok.slice('--locale='.length);
    } else if (tok === '--locale') {
      // value should follow; handled by the dispatcher's parseFlags already
    }
  }
  return { flags };
}

function reportFile(rel, result) {
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

export function langHelp() {
  return `cossack lang <subcommand>

Manage localization catalogs under src/lang/.

Subcommands:
  publish                Create src/lang/en.json with starter keys.
  add <locale>           Create src/lang/<locale>.json with empty values,
                         mirroring the keys of an existing en.json.

Options:
  --locale=<code>        Override the default locale for \`publish\` (default: en).
  --force, -f            Overwrite an existing file.
  --dry-run              Show what would happen without writing.`;
}
