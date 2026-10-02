import type { CapabilityDiagnostic } from '@cossackframework/core/runtime-capabilities';

export type Adapter = 'cloudflare' | 'node' | 'deno';
export type Preset = 'minimal' | 'database' | 'auth' | 'full-stack';
export type Feature = 'ui' | 'database' | 'studio' | 'auth' | 'dashboard' | 'markdown' | 'examples' | 'desktop' | 'resource' | 'mutation' | 'scoped-service' | 'protected-route';
export type AuthMethod = 'credentials' | 'oauth';
export type DatabaseProvider = 'd1' | 'sqlite' | 'turso' | 'postgres' | 'mysql' | 'hyperdrive-postgres' | 'hyperdrive-mysql';
export type OAuthProvider = 'github' | 'google' | 'gitlab' | 'facebook' | 'microsoft';
export type UITheme = 'default' | 'neutral' | 'zinc' | 'stone' | 'gray' | 'slate' | 'blue' | 'green' | 'red';
export type DashboardModule = 'users' | 'sessions' | 'settings' | 'roles';

export interface ScaffoldRecipe {
  adapter: Adapter;
  preset: Preset;
  explicitFeatures: Feature[];
  resolvedFeatures: Feature[];
  dashboardModules: DashboardModule[];
  config: {
    database: DatabaseProvider;
    authMethods: AuthMethod[];
    oauth: OAuthProvider[];
    theme: UITheme;
  };
}

export interface CreateAppOptions {
  dryRun?: boolean;
  adapter?: Adapter;
  preset?: Preset;
  features?: Feature[] | string;
  database?: DatabaseProvider;
  runtime?: Adapter;
  authMethods?: AuthMethod[] | string;
  oauth?: OAuthProvider[] | string;
  theme?: UITheme;
  dashboardModules?: DashboardModule[] | string;
  dashboardFeatures?: DashboardModule[] | string;
  interactive?: boolean;
  confirm?: boolean;
  yes?: boolean;
  cwd?: string;
  force?: boolean;
}

export interface AddFeatureOptions extends Omit<CreateAppOptions, 'preset' | 'features'> {
  features?: DashboardModule[] | string;
  dryRun?: boolean;
}

export interface SwitchAdapterOptions {
  database?: DatabaseProvider;
  interactive?: boolean;
  yes?: boolean;
  confirm?: boolean;
  force?: boolean;
  dryRun?: boolean;
}

export declare const ADAPTERS: readonly Adapter[];
export declare const FEATURES: readonly Feature[];
export declare const AUTH_METHODS: readonly AuthMethod[];
export declare const OAUTH_PROVIDERS: readonly OAuthProvider[];
export declare const UI_THEMES: readonly UITheme[];
export declare const DASHBOARD_MODULES: readonly DashboardModule[];
export declare const FEATURE_REGISTRY: Record<Feature, { requires: Feature[] }>;
export declare const PRESET_REGISTRY: Record<Preset, { features: Feature[]; dashboardModules?: readonly DashboardModule[] }>;
export declare const DATABASE_PROVIDERS: Record<DatabaseProvider, { adapters: readonly Adapter[] }>;
export declare function parseList(value: unknown): string[];
export declare function resolveFeatures(features: Feature[] | string): Feature[];
export declare function removeFeature(features: Feature[] | string, feature: Feature): Feature[];
export declare function resolveDashboardModules(value: DashboardModule[] | string | undefined, dashboardSelected: boolean): DashboardModule[];
export declare function resolveRecipe(options?: CreateAppOptions): ScaffoldRecipe;
export declare function createApp(projectName: string, options?: CreateAppOptions): Promise<{
  status: 'created' | 'cancelled' | 'dry-run';
  changes?: ChangeSet;
  projectDir: string;
  adapter: Adapter;
  manifestPath: string;
  recipe: ScaffoldRecipe;
}>;
export declare function addFeature(projectDir: string, feature: Feature, options?: AddFeatureOptions): Promise<{
  status: 'added' | 'present' | 'cancelled' | 'dry-run';
  recipe: ScaffoldRecipe;
  changes: ChangeSet;
  addedFeatures: Feature[];
  addedDashboardModules: DashboardModule[];
  manifestPath: string;
}>;
export declare function removeFeatureFromProject(
  projectDir: string,
  feature: Feature,
  options?: Pick<AddFeatureOptions, 'interactive' | 'confirm' | 'yes' | 'force' | 'dryRun'>,
): Promise<{
  status: 'removed' | 'absent' | 'cancelled' | 'dry-run';
  recipe: ScaffoldRecipe;
  changes: ChangeSet;
  manifestPath: string;
}>;
export declare function switchAdapter(
  projectDir: string,
  target: Adapter,
  options?: SwitchAdapterOptions,
): Promise<{
  status: 'changed' | 'present' | 'cancelled' | 'dry-run';
  previousAdapter: Adapter;
  targetAdapter: Adapter;
  databaseChange: {
    previous: DatabaseProvider;
    target: DatabaseProvider;
    changed: boolean;
    installed: boolean;
  };
  recipe: ScaffoldRecipe;
  changes: ChangeSet;
  manifestPath: string;
}>;
export interface ChangeSet {
  writes: Array<{ path: string; capability: string; overwrite: boolean }>;
  deletes: Array<{ path: string; capability: string }>;
  conflicts: string[];
  preserved: Array<{
    path: string;
    capability: string;
    reason: 'user-owned' | 'locally-deleted' | 'locally-modified';
  }>;
}
export declare function renderRecipe(recipe: ScaffoldRecipe, options?: { projectName?: string }): Promise<Map<string, {
  content: Buffer;
  capability: string;
}>>;
export type DependencyBaseline = Partial<Record<'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies', Record<string, string>>>;
export declare function dependencyBaseline(pkg: DependencyBaseline): DependencyBaseline;
export declare function planDependencyChanges(current: DependencyBaseline, desired: DependencyBaseline,
  previous?: DependencyBaseline, options?: { force?: boolean }): {
  next: DependencyBaseline;
  baseline: DependencyBaseline;
  updates: Array<{ name: string; section: string; from: string; to: string; changed: true }>;
  additions: Array<{ name: string; section: string; to: string }>;
  removals: Array<{ name: string; section: string; from: string }>;
  preserved: Array<{ name: string; reason: string; sections: string[] }>;
  conflicts: Array<{ name: string; reason: string; resolution: 'preserve' }>;
};
export declare function migratePnpmBuildSettings(
  projectDir: string,
  recipe: ScaffoldRecipe,
  options?: { dryRun?: boolean },
): Promise<{
  changed: boolean;
  packageChanged: boolean;
  workspaceChanged: boolean;
}>;
export declare function planChanges(projectDir: string, recipe: ScaffoldRecipe, manifest?: unknown): Promise<ChangeSet>;
export declare function resolveManifestRecipe(manifest: unknown): ScaffoldRecipe;
export declare function readManifest(projectDir: string): Promise<any | null>;
export declare function detectProjectRuntime(projectDir: string, manifest?: unknown): Promise<Adapter | undefined>;
export declare function writeManifest(
  projectDir: string,
  recipe: ScaffoldRecipe,
  files: Map<string, unknown>,
  previousManifest?: unknown,
  changes?: ChangeSet,
): Promise<string>;
export declare class PromptAbortedError extends Error {
  code: 'COSSACK_PROMPT_ABORTED';
}

/** Serializable selected recipe requirements, compatible with framework build checks. */
export interface RecipeCapabilityUse {
  feature: string;
  source: { file: string };
  requires: { transports?: readonly ('http' | 'sse' | 'durable-object')[]; filesystem?: boolean; cloudflareBindings?: readonly string[] };
}
export declare function recipeCapabilityRequirements(recipe: ScaffoldRecipe, target?: 'web' | 'desktop'): RecipeCapabilityUse[];
export interface RecipeCapabilityDiagnostic extends CapabilityDiagnostic {
  target: 'web' | 'desktop';
}
export declare function recipeCapabilityDiagnostics(recipe: ScaffoldRecipe): RecipeCapabilityDiagnostic[];
