/**
 * The static registry of rendered plugins (`src/plugins/<name>/`), emitted at build time.
 * Server environments get each manifest and the plugin's optional `server.ts` module;
 * every environment gets names, versions, the optional `ui.ts` module (host slot
 * components), the `templates/*.ts` modules (a theme's templates) and the URLs of images in
 * `assets/`, such as a logo and a cover. Nothing scans packages at request time.
 */
import registry from 'virtual:cossack-plugins';

/** Rendered manifest data. Each plugin host validates its own fields. */
export interface PluginManifestData {
  readonly name: string;
  readonly version: string;
  readonly [field: string]: unknown;
}

export interface PluginRegistration {
  readonly name: string;
  readonly version: string;
  /** Server environments only. */
  readonly manifest?: PluginManifestData;
  /** The plugin's `server.ts` exports; server environments only, null when absent. */
  readonly module?: Record<string, unknown> | null;
  /** The plugin's `ui.ts` exports (components for host slots), in every environment; null when absent. */
  readonly ui: Record<string, unknown> | null;
  /** The plugin's `templates/*.ts` modules by file stem (`entry-posts` for `templates/entry-posts.ts`), in every environment. */
  readonly templates: Readonly<Record<string, Record<string, unknown>>>;
  /** URLs of the images in the plugin's `assets/` directory, by path such as `assets/logo.png`. */
  readonly assets: Readonly<Record<string, string>>;
}

export const plugins: readonly PluginRegistration[] = registry;

export function getPlugin(name: string): PluginRegistration | undefined {
  return plugins.find(plugin => plugin.name === name);
}
