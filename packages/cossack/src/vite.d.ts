import type { ConfigEnv, PluginOption, UserConfig } from 'vite';
import type { CossackPagesOptions } from '@cossackframework/framework/vite-plugin';

export interface CossackAppOptions {
  /** The project directory. Defaults to the directory Vite runs in. */
  root?: string;
  /** The runtime, when the project does not record one: `cloudflare` or `node`. */
  runtime?: 'cloudflare' | 'node';
  /**
   * The project's own processor of Markdown pages. Without it, a project with the `markdown`
   * feature uses the framework's `processMarkdown` (`@cossackframework/framework/markdown-processor`).
   */
  markdownProcessor?: CossackPagesOptions['markdownProcessor'];
  /** The Wrangler configuration file, when it is not the project's `wrangler.jsonc`. */
  configPath?: string;
  /** More options for `cossackBuildBudgets()`. */
  budgets?: Record<string, unknown>;
  /** More options for `cossackPages()`. `capabilities` is merged with the project's own. */
  pages?: CossackPagesOptions;
  /** More options for `cossackSecurityPlugin()`. */
  security?: Record<string, unknown>;
  /** Options for `cossackSsg()`, or false to leave static generation out. */
  ssg?: Record<string, unknown> | false;
  /** More options for Cloudflare's Vite plugin, such as `configPath`. */
  cloudflare?: Record<string, unknown>;
  /** More options for the Node adapter's Vite plugin. */
  node?: Record<string, unknown>;
  /** More parts, each a `cossackVite` function as a mounted package exports one. */
  parts?: Array<(context: { root: string; runtime: string; mode: string; command: 'build' | 'serve' }) => unknown>;
  /** More Vite plugins, after the preset's. */
  plugins?: PluginOption[];
  /** More Vite configuration, merged last. */
  config?: UserConfig | ((env: ConfigEnv) => UserConfig | Promise<UserConfig>);
}

/**
 * The Vite configuration of a Cossack application: the framework's plugins, the runtime's and
 * those of the features and mounted packages the project uses.
 *
 *   // vite.config.ts
 *   import { cossackApp } from 'cossack/vite';
 *   export default cossackApp();
 */
export function cossackApp(options?: CossackAppOptions): (env: ConfigEnv) => Promise<UserConfig>;

/** The file an import of `specifier` from the project resolves to, or null when it is not installed. */
export function projectModule(root: string, specifier: string): string | null;
