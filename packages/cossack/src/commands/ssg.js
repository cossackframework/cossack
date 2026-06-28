/**
 * `cossack ssg` — pre-render pages marked `ssg: true` to static HTML.
 *
 * The tsx respawn happens in bin/cossack.js (only for this command). By the
 * time this module runs, the tsx loader is active and we can import the
 * compiled framework engine directly.
 */
export async function ssgCommand(args, ctx) {
  const options = parseOptions(args);
  const { buildSsg } = await import('@cossackframework/framework/ssg-build');
  try {
    await buildSsg(options);
    return 0;
  } catch (err) {
    console.error('SSG build failed:', err?.stack || err?.message || err);
    return 1;
  }
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

export function ssgHelp() {
  return `cossack ssg [options]

Pre-render pages marked with \`ssg: true\` to static HTML.
Must be run after \`vite build\` (which emits cossack-routes.json).

Options:
  --project-root <path>   Project root (defaults to current directory).
  --out-dir <path>        Output directory (defaults to <root>/dist/client).
  --base-url <url>        Base URL for the sitemap / canonical tags.
  --app <path>            Path to the module exporting your App.
  --template <path>       Path to the module exporting the html template.`;
}
