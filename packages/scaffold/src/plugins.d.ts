export declare const PLUGIN_PACKAGE_FIELD: 'cossack';
export declare const PLUGIN_MANIFEST_DEFAULT: 'cossack-plugin.json';
export declare const PLUGINS_DIRECTORY: 'src/plugins';
export declare const PLUGINS_STATE: '.cossack/plugins.json';
export declare const PLUGIN_NAME: RegExp;
export declare const RESERVED_PLUGIN_NAMES: ReadonlySet<string>;

export interface PluginManifest {
  schemaVersion: 1;
  name: string;
  version: string;
  /** Source directory inside the package. Default `plugin`. */
  source?: string;
  description?: string;
  /** Package name to version range, checked against installed versions. */
  compatibility?: Record<string, string>;
  /** Runtime packages the rendered source imports, added to the application. */
  dependencies?: Record<string, string>;
  /** Host-specific fields, such as CMS permissions, hooks and resources. */
  [field: string]: unknown;
}

export interface PluginPackage {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly manifest: Readonly<PluginManifest>;
  readonly files: ReadonlyMap<string, Buffer>;
}

export interface PluginSourceRecord { type: 'npm' | 'tarball' | 'directory'; spec: string }

export interface PluginStateEntry {
  package: string;
  version: string;
  source: PluginSourceRecord;
  files: Record<string, { capability: string; hash: string }>;
}

export interface PluginState { schemaVersion: 1; plugins: Record<string, PluginStateEntry> }

export interface PluginChangeSet {
  writes: { path: string; capability: string; overwrite: boolean }[];
  deletes: { path: string; capability: string }[];
  conflicts: string[];
  preserved: { path: string; capability: string; reason: 'locally-deleted' | 'locally-modified' }[];
}

export interface PluginRenderOptions {
  force?: boolean;
  dryRun?: boolean;
  /** Install an npm spec; default runs `pnpm add --save-dev --ignore-scripts`. False requires it installed. */
  install?: false | ((spec: string, projectDir: string) => Promise<void>);
  /** Installed versions checked against `compatibility`, such as `{ '@cossackframework/framework': '0.9.0' }`. */
  versions?: Record<string, string>;
  /** Upgrade only: render from this source instead of the recorded one. */
  source?: string;
}

export interface PluginRenderResult {
  status: 'added' | 'upgraded' | 'present' | 'dry-run';
  name: string;
  package: string;
  version: string;
  from: string | null;
  changes: PluginChangeSet;
  dependencies: { name: string; from: null; to: string }[];
}

export declare class PluginError extends Error {
  code: string;
  conflicts?: string[];
  problems?: string[];
}

export declare function validatePluginManifest(manifest: unknown, packageJson?: { version?: string }): string[];
export declare function readPluginDirectory(directory: string): Promise<PluginPackage>;
export declare function readPluginTarball(file: string): Promise<PluginPackage>;
export declare function renderPlugin(plugin: PluginPackage): Map<string, { content: Buffer; capability: string }>;
export declare function readPluginState(projectDir: string): Promise<PluginState>;
export declare function planPlugin(projectDir: string, rendered: Map<string, { content: Buffer; capability: string }>, previousFiles?: PluginStateEntry['files'], force?: boolean): Promise<PluginChangeSet>;
export declare function addPlugin(projectDir: string, source: string, options?: PluginRenderOptions): Promise<PluginRenderResult>;
export declare function upgradePlugin(projectDir: string, name: string, options?: PluginRenderOptions): Promise<PluginRenderResult>;
export declare function removePlugin(projectDir: string, name: string, options?: Pick<PluginRenderOptions, 'force' | 'dryRun'>): Promise<{ status: 'removed' | 'dry-run'; name: string; changes: PluginChangeSet }>;
export declare function listPlugins(projectDir: string): Promise<{
  rendered: { name: string; package: string; version: string; source: PluginSourceRecord }[];
  installed: { package: string; version: string; plugin: string | null; rendered: boolean; problems: string[] }[];
}>;
export declare function satisfies(version: string, range: string): boolean;
