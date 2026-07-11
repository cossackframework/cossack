import { run } from '../spawn.js';

/**
 * Legacy SSG CLI flags that mapped to `buildSsg()` options. SSG now runs inside
 * `vite build` via the `cossackSsg()` plugin, so these are configured in
 * `vite.config.ts` instead. We warn (and strip them) rather than forward to
 * `vite build`, which would silently ignore unknown flags — a base URL or app
 * path configured this way would be silently dropped.
 */
const LEGACY_FLAGS = new Set([
  '--base-url', '--baseUrl',
  '--out-dir', '--outDir',
  '--project-root', '--projectRoot',
  '--app',
  '--template',
]);

/**
 * `cossack ssg` — pre-render pages marked `ssg: true` (and all `.md`/`.mdx`
 * pages) to static HTML.
 *
 * SSG runs inside `vite build` via the `cossackSsg()` Vite plugin, so this
 * command is a thin wrapper around `vite build`. The plugin's `closeBundle`
 * hook renders SSG pages during the build (no separate tsx process).
 *
 * Extra args are forwarded to vite. SSG-specific options (base URL, output
 * directory) are configured on the `cossackSsg()` plugin in `vite.config.ts`.
 */
export async function ssgCommand(args, ctx) {
  const { viteArgs, legacy } = splitArgs(args);
  if (legacy.length > 0) {
    console.warn(
      '[cossack/ssg] The following flags are no longer supported and were ignored:\n' +
        legacy.map((f) => `  ${f.flag}${f.value ? ` ${f.value}` : ''}`).join('\n') +
        '\nSSG now runs inside `vite build` via the `cossackSsg()` plugin. Configure ' +
        'these in vite.config.ts instead, e.g. cossackSsg({ baseUrl, outDir }).',
    );
  }
  console.log('  ssg   vite build (SSG runs via the cossackSsg plugin)');
  return run('vite', ['build', ...viteArgs]);
}

/**
 * Separate legacy SSG flags (and their values) from args meant for vite.
 * Each legacy flag takes a single value (e.g. `--base-url <url>`).
 *
 * Exported for unit testing.
 */
export function splitArgs(args) {
  const viteArgs = [];
  const legacy = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (LEGACY_FLAGS.has(a)) {
      const value = i + 1 < args.length && !args[i + 1].startsWith('-') ? args[i + 1] : undefined;
      legacy.push({ flag: a, value });
      if (value !== undefined) i += 1; // consume the value
    } else if (a.includes('=') && LEGACY_FLAGS.has(a.split('=')[0])) {
      // `--base-url=<url>` form
      legacy.push({ flag: a.split('=')[0], value: a.slice(a.indexOf('=') + 1) });
    } else {
      viteArgs.push(a);
    }
  }
  return { viteArgs, legacy };
}

export function ssgHelp() {
  return `cossack ssg [options]

Pre-render pages marked with \`ssg: true\` (and all \`.md\`/\`.mdx\` pages) to
static HTML.

SSG runs as part of \`vite build\` (via the \`cossackSsg\` plugin), so this
command delegates to \`vite build\`. Extra args are forwarded to vite.

SSG options are configured on the \`cossackSsg\` plugin in \`vite.config.ts\`:

    import { cossackSsg } from '@cossackframework/framework/vite-ssg-plugin';

    export default defineConfig({
      plugins: [/* ... */, cossackSsg({
        baseUrl: 'https://example.com',  // default: getSiteUrl() (APP_URL)
        outDir: 'dist/client',           // default: <root>/dist/client
        enabled: true,                   // default: true; false skips SSG
      })],
    });`;
}
