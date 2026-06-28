#!/usr/bin/env node
/**
 * `cossack` CLI.
 *
 *   cossack ssg [--project-root <path>] [--out-dir <path>] [--base-url <url>]
 *               [--app <path>] [--template <path>]
 *
 * Runs the SSG build using the `cossack-routes.json` manifest emitted by the
 * Cossack Vite plugin and the project's own `App` + html template. Must be run
 * after `vite build`.
 *
 * The process re-spawns itself under `node --import tsx` (once) so the tsx
 * loader is active globally. This lets the engine natively `import()` both the
 * compiled framework ESM (which uses bundler-style extensionless relative
 * imports) and the user's `.ts` pages/App — all through a single shared module
 * registry, which is what preserves class identity
 * (e.g. `pageClass.prototype instanceof Cossack`) across the engine and user
 * pages.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RESPAWN_FLAG = '__COSSACK_SSG_RESPAWNED';

// Resolve tsx from THIS package's location (framework declares tsx as a dep),
// so the loader is found regardless of the user's cwd.
const requireFromHere = createRequire(import.meta.url);
let tsxImportUrl;
try {
  tsxImportUrl = pathToFileURL(requireFromHere.resolve('tsx')).href;
} catch {
  console.error(
    '[cossack] Could not resolve "tsx". Ensure @cossackframework/framework is installed.',
  );
  process.exit(1);
}

function run(args) {
  const options = parseOptions(args);
  return import('../dist/esm/ssg-build.js')
    .then(({ buildSsg }) => buildSsg(options))
    .catch((err) => {
      console.error('SSG build failed:', err);
      process.exit(1);
    });
}

function parseOptions(rest) {
  const flag = (name) => {
    const idx = rest.indexOf(name);
    return idx !== -1 && rest[idx + 1] ? rest[idx + 1] : undefined;
  };
  const options = {};
  const projectRoot = flag('--project-root') || flag('--projectRoot');
  if (projectRoot) options.projectRoot = projectRoot;
  const outDir = flag('--out-dir') || flag('--outDir');
  if (outDir) options.outDir = outDir;
  const baseUrl = flag('--base-url') || flag('--baseUrl');
  if (baseUrl) options.baseUrl = baseUrl;
  const app = flag('--app');
  if (app) options.appPath = app;
  const template = flag('--template');
  if (template) options.templatePath = template;
  return options;
}

function help() {
  console.log(`cossack <command> [options]

Commands:
  ssg          Pre-render pages marked with \`ssg: true\` to static HTML.

Options:
  --project-root <path>   Project root (defaults to current directory).
  --out-dir <path>        Output directory (defaults to <root>/dist/client).
  --base-url <url>        Base URL for the sitemap / canonical tags.
  --app <path>            Path to the module exporting your App.
  --template <path>       Path to the module exporting your html template.`);
}

const argv = process.argv.slice(2);
const [command, ...rest] = argv;

if (command === '--help' || command === '-h') {
  help();
  process.exit(0);
}

if (command !== 'ssg') {
  console.error(`Unknown command: ${command || '(none)'}`);
  help();
  process.exit(1);
}

if (process.env[RESPAWN_FLAG]) {
  // tsx loader is active — do the real work.
  run(rest);
} else {
  // Re-spawn under `node --import <tsx>` so the loader is active for the engine
  // import below. Use the resolved tsx URL (not the bare specifier) so it is
  // found regardless of the invoking cwd.
  const binPath = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, ['--import', tsxImportUrl, binPath, ...argv], {
    stdio: 'inherit',
    env: { ...process.env, [RESPAWN_FLAG]: '1' },
  });
  child.on('exit', (code) => process.exit(code ?? 1));
}
