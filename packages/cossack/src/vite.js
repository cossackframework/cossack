// The Vite configuration of a Cossack application, as one call: a project's vite.config.ts is
// `export default cossackApp()`. What the configuration holds comes from the project itself
// (its runtime, its features, the packages it mounts and what it has installed), so a release
// changes this file and never the project's.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mergeConfig } from 'vite';

const packageOf = specifier => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');

/** The target of a package's `exports` entry for an ES import, or undefined. */
function exportTarget(exports, subpath) {
  const conditional = value => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) { for (const item of value) { const found = conditional(item); if (found) return found; } return undefined; }
    if (!value || typeof value !== 'object') return undefined;
    for (const [condition, target] of Object.entries(value)) {
      if (!['import', 'node', 'module-sync', 'default'].includes(condition)) continue;
      const found = conditional(target);
      if (found) return found;
    }
    return undefined;
  };
  if (exports && typeof exports === 'object' && !Array.isArray(exports) && Object.keys(exports).some(key => key.startsWith('.'))) {
    return conditional(exports[subpath]);
  }
  return subpath === '.' ? conditional(exports) : undefined;
}

/** The directory of a package the project has, or null. */
function packageDirectory(root, name) {
  for (let current = root; ; current = path.dirname(current)) {
    const candidate = path.join(current, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
    if (path.dirname(current) === current) return null;
  }
}

/** Every import a package exports (`name`, `name/subpath`), without patterns; none when the project lacks it. */
export function packageEntries(root, name) {
  const directory = packageDirectory(root, name);
  if (!directory) return [];
  const exported = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).exports;
  if (!exported || typeof exported !== 'object' || !Object.keys(exported).some(key => key.startsWith('.'))) return [name];
  return Object.keys(exported).filter(key => key.startsWith('.') && !key.includes('*') && !/\.(?:json|css)$/.test(key))
    .map(key => name + key.slice(1));
}

/**
 * The file an import of `specifier` from the project resolves to, or null when the project
 * does not have the package. This module is in the CLI's package, which cannot resolve the
 * project's dependencies under a strict install, and Node resolves an ES import only from
 * the importing file.
 */
export function projectModule(root, specifier) {
  const name = packageOf(specifier);
  const directory = packageDirectory(root, name);
  if (!directory) return null;
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const subpath = `.${specifier.slice(name.length)}`;
  const target = manifest.exports !== undefined ? exportTarget(manifest.exports, subpath)
    : subpath === '.' ? manifest.module ?? manifest.main ?? 'index.js' : subpath;
  if (target) return path.join(directory, target);
  try { return createRequire(path.join(root, 'package.json')).resolve(specifier); } catch { return null; }
}

async function projectImport(root, specifier, required = true) {
  const file = projectModule(root, specifier);
  if (!file) {
    if (!required) return null;
    throw new Error(`[cossack] ${specifier} is not installed in this project. Install ${packageOf(specifier)} and run the command again.`);
  }
  return import(pathToFileURL(file).href);
}

/** The project's recipe (runtime and features), or null for a project the scaffold did not make. */
async function projectRecipe(root) {
  const { readManifest, resolveManifestRecipe, recipeCapabilityRequirements } = await import('@cossackframework/scaffold');
  try {
    const manifest = await readManifest(root);
    if (!manifest) return null;
    const recipe = resolveManifestRecipe(manifest);
    return { runtime: recipe.adapter, features: recipe.resolvedFeatures,
      requirements: target => recipeCapabilityRequirements(recipe, target) };
  } catch { return null; }
}

/**
 * The Vite configuration of this project.
 *
 * - `markdownProcessor`: the project's own processor of Markdown pages. A project with the
 *   `markdown` feature gets the framework's (`@cossackframework/framework/markdown-processor`)
 *   without it.
 * - `configPath`: the Wrangler configuration file, when it is not the project's wrangler.jsonc.
 *   Every plugin that reads it gets the path.
 * - `pages`, `security`, `ssg`, `cloudflare`, `budgets`, `node`: options added to those
 *   plugins' own; `ssg: false` leaves static generation out.
 * - `plugins`: more Vite plugins, after the preset's.
 * - `parts`: `cossackVite` functions, each adding a part as a mounted package's does.
 * - `config`: more Vite configuration, or a function of Vite's `{ mode, command }` that
 *   returns it. It is merged last, so it wins.
 */
export function cossackApp(options = {}) {
  return async (env) => {
    const { mode, command } = env;
    const root = options.root ? path.resolve(options.root) : process.cwd();
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const installed = { ...manifest.dependencies, ...manifest.devDependencies };
    const has = name => Object.hasOwn(installed, name);
    const recipe = await projectRecipe(root);
    const runtime = options.runtime ?? recipe?.runtime ?? manifest.cossack?.runtime ?? 'cloudflare';
    const features = new Set(recipe?.features ?? []);
    const desktop = mode === 'desktop';

    const framework = await projectImport(root, '@cossackframework/framework/vite-plugin');
    const { cossackSecurityPlugin } = await projectImport(root, '@cossackframework/framework/vite-security-plugin');
    const { cossackSsg } = await projectImport(root, '@cossackframework/framework/vite-ssg-plugin');
    const { mountedPackages } = await projectImport(root, '@cossackframework/framework/package-mounts');

    // A mounted package gives its own part: the CMS starts its database in development,
    // delivers its icons and names where isolated plugins run.
    const parts = [];
    for (const mounted of mountedPackages(root)) {
      if (!mounted.vite) continue;
      const module = await import(pathToFileURL(mounted.vite).href);
      if (typeof module.cossackVite !== 'function') throw new Error(`[cossack] ${mounted.name}: ${mounted.vite} does not export cossackVite.`);
      parts.push(await module.cossackVite({ root, mode, command, runtime }) ?? {});
    }
    // `parts` adds more of them: the package's own application holds the served files as
    // source and mounts nothing, so it names the package's part itself.
    for (const part of options.parts ?? []) parts.push(await part({ root, mode, command, runtime }) ?? {});
    const partOptions = key => Object.assign({}, ...parts.map(part => part[key] ?? {}));

    const wrangler = options.configPath ? { configPath: options.configPath } : {};
    const plugins = [];
    for (const part of parts) plugins.push(...(part.setup ?? []));
    if (runtime === 'node' && !desktop) {
      const { cossackNode } = await projectImport(root, '@cossackframework/node-adapter/vite');
      plugins.push(cossackNode({ ...options.node }));
    }
    const tailwind = await projectImport(root, '@tailwindcss/vite', false);
    if (tailwind) plugins.push(tailwind.default());
    if (runtime === 'cloudflare' && !desktop) {
      const { cloudflare } = await projectImport(root, '@cloudflare/vite-plugin');
      plugins.push(cloudflare({ viteEnvironment: { name: 'ssr' }, ...partOptions('cloudflare'), ...wrangler, ...options.cloudflare }),
        framework.cossackBuildBudgets({ ...wrangler, ...options.budgets }));
    }
    plugins.push(cossackSecurityPlugin({ devWarning: true, ...options.security }));
    // Markdown pages: the framework's processor (GFM, a table of contents, highlighted code,
    // front matter), unless the project gives its own.
    let markdownProcessor = options.markdownProcessor;
    if (!markdownProcessor && features.has('markdown')) {
      ({ processMarkdown: markdownProcessor } = await projectImport(root, '@cossackframework/framework/markdown-processor'));
    }
    // What the project's features need from the runtime; the build fails when it lacks one.
    const capabilities = recipe || options.pages?.capabilities ? {
      ...(recipe ? { runtime: desktop ? 'desktop' : runtime, requirements: recipe.requirements(desktop ? 'desktop' : 'web') } : {}),
      ...options.pages?.capabilities,
    } : undefined;
    plugins.push(framework.cossackPages({
      ...partOptions('pages'),
      ...wrangler,
      ...(markdownProcessor ? { markdownProcessor } : {}),
      // Desktop imports every page before its window opens: a window that opened on a page
      // that failed to load has nothing to reload it once the page is repaired.
      ...(desktop ? { deferPages: false } : {}),
      ...options.pages,
      ...(capabilities ? { capabilities } : {}),
    }));
    plugins.push(framework.cossackLang(), framework.cossackMiddlewares(), framework.cossackConfig({ ...wrangler }));
    if (features.has('workflows')) plugins.push(framework.cossackWorkflows());
    if (features.has('schedules')) plugins.push(framework.cossackSchedules());
    if (parts.some(part => part.pluginPolicy)) {
      // Rendered plugins must stay within their manifest; violations fail the build.
      const { cossackPluginPolicy } = await import('./plugin-policy.js');
      plugins.push(cossackPluginPolicy());
    }
    for (const part of parts) plugins.push(...(part.plugins ?? []));
    // SSG: renders pages marked `@Page({ ssg: true })` to static HTML during `vite build`.
    if (options.ssg !== false) plugins.push(cossackSsg({ ...wrangler, ...options.ssg }));
    plugins.push(...(options.plugins ?? []));

    const optional = ['@cossackframework/ui', '@cossackframework/solar-icons', '@cossackframework/auth', '@cossackframework/database'].filter(has);
    // The development server bundles core and the renderer with the packages that import them:
    // unbundled they are over a hundred modules, each a round trip between the Worker and Vite
    // on every start. Every entry is listed, so all of their users (the bundled packages, the
    // application's files and the served ones) share the one copy in the bundle: an entry left
    // out would load from its files beside it, and a second renderer prints repeat() as text.
    // A build and Desktop keep them out of the bundle, as before.
    const sharedEntries = command === 'serve' && !desktop
      ? ['@cossackframework/core', '@cossackframework/renderer'].flatMap(name => packageEntries(root, name)) : [];
    const base = {
      // Runtime files are not source code and must never reach Vite's watcher: local D1
      // updates its WAL/SHM files under .wrangler, RomeDB and media land in storage/, and
      // queued RomeDB writes pass through .cossack/*-pending. Tailwind treats a changed file of
      // unknown extension as a possible class source and answers it with a full page reload,
      // which would drop unsaved form input on every database write.
      server: { watch: { ignored: ['**/.wrangler/**', '**/storage/**', '**/.cossack/*-pending/**'] } },
      plugins,
      // Vite leaves SSR output unminified by default. This shared default also covers the
      // separate `vite build --ssr` used by the Node adapter.
      build: { minify: true },
      resolve: {
        // Linked Cossack packages otherwise resolve shared dependencies from both the app and
        // framework workspaces. A single project-root copy prevents Vite's dependency
        // optimizer from repeatedly invalidating the browser.
        dedupe: ['@cossackframework/core', '@cossackframework/renderer', '@cossackframework/framework',
          ...optional.filter(name => name !== '@cossackframework/database'), 'hono', 'reflect-metadata'],
        alias: { '@': path.join(root, 'src'), '~': path.join(root, 'dist/client') },
      },
      environments: {
        client: {
          build: {
            outDir: 'dist/client',
            target: 'esnext',
            manifest: true,
            rolldownOptions: {
              input: 'src/client/entry-client.ts',
              output: {
                entryFileNames: 'assets/[name].[hash].js',
                chunkFileNames: 'assets/[name].[hash].js',
                assetFileNames: 'assets/[name].[hash][extname]',
                format: 'esm',
              },
            },
          },
        },
        ssr: {
          build: {
            // Keep authored server locations in private build artifacts for diagnosis.
            // Client maps remain opt-in; Desktop keeps its existing build defaults.
            sourcemap: !desktop,
            // Asset URLs the server renders, such as a theme's stylesheet, name the files the
            // client build emits, so both builds name assets alike, and make stylesheets for
            // the same browsers: otherwise each build hashes its own copy and the page loads both.
            cssTarget: 'esnext',
            rolldownOptions: { output: { assetFileNames: 'assets/[name].[hash][extname]' } },
          },
          resolve: desktop && command === 'build'
            // Forge omits node_modules from packaged applications. Bundle the complete
            // main-process graph while preserving Electron's native runtime module and Node
            // built-ins as external imports.
            ? { external: ['electron'], noExternal: true }
            // Solar Icons publishes TypeScript runtime entry points. Transform UI and its icon
            // dependency in Vite's SSR graph rather than passing raw TypeScript to Node's
            // native module loader.
            : { noExternal: ['hono', 'css-tree', ...optional.filter(name => /\/(ui|solar-icons)$/.test(name))] },
          // Cloudflare starts the SSR worker eagerly in development. Pre-bundling the large
          // shared packages avoids transforming their full dependency graphs one module at a
          // time on every cold start. Route API handlers and page inspectors load these entries
          // after the initial scan; include them here so late discovery does not replace the
          // SSR cache under the worker. The framework's plugin adds the dependencies that the
          // application's and the mounted packages' files import.
          // Vite transforms a module's imports while the server evaluates the module, not one
          // request at a time as the server reaches each. Desktop keeps Vite's default: its
          // window reports a startup error from the request that met it.
          ...(desktop ? {} : { dev: { preTransformRequests: true } }),
          optimizeDeps: {
            include: [
              '@cossackframework/renderer > parse5',
              ...sharedEntries,
              ...optional.filter(name => name !== '@cossackframework/solar-icons'),
              // The blocks entry with the root one: left out, its components load unbundled
              // beside the bundled ones and their icons are found late, one reload per wave.
              ...(has('@cossackframework/ui') ? ['@cossackframework/ui/blocks'] : []),
              '@cossackframework/framework/cache',
              '@cossackframework/framework/api',
              '@cossackframework/framework/client/devtools',
              'hono/cookie',
            ],
            // Without their bundle (a build, Desktop), pre-bundled packages import core and the
            // renderer rather than embedding copies: one of each keeps directive classes and
            // request state shared with application code.
            ...(sharedEntries.length ? {} : { exclude: ['@cossackframework/core', '@cossackframework/renderer'] }),
          },
        },
      },
    };
    let config = base;
    for (const part of parts) if (part.config) config = mergeConfig(config, part.config);
    const own = typeof options.config === 'function' ? await options.config(env) : options.config;
    return own ? mergeConfig(config, own) : config;
  };
}
