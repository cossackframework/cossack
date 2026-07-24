export type Adapter = 'cloudflare' | 'node';
export type Preset = 'minimal' | 'database' | 'auth' | 'full-stack';
export type Feature = 'ui' | 'database' | 'auth' | 'dashboard' | 'examples';
export type DatabaseProvider = 'd1' | 'sqlite' | 'turso';
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
    oauth: OAuthProvider[];
    theme: UITheme;
  };
}

export interface CreateAppOptions {
  adapter?: Adapter;
  preset?: Preset;
  features?: Feature[] | string;
  database?: DatabaseProvider;
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

export declare const ADAPTERS: readonly Adapter[];
export declare const FEATURES: readonly Feature[];
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
  projectDir: string;
  adapter: Adapter;
  manifestPath: string;
  recipe: ScaffoldRecipe;
}>;
export declare function addFeature(projectDir: string, feature: Feature, options?: AddFeatureOptions): Promise<{
  status: 'added' | 'present' | 'cancelled' | 'dry-run';
  recipe: ScaffoldRecipe;
  changes: ChangeSet;
  manifestPath: string;
}>;
export interface ChangeSet {
  writes: Array<{ path: string; capability: string; overwrite: boolean }>;
  deletes: Array<{ path: string; capability: string }>;
  conflicts: string[];
}
export declare function renderRecipe(recipe: ScaffoldRecipe, options?: { projectName?: string }): Promise<Map<string, {
  content: Buffer;
  capability: string;
}>>;
export declare function planChanges(projectDir: string, recipe: ScaffoldRecipe, manifest?: unknown): Promise<ChangeSet>;
export declare function readManifest(projectDir: string): Promise<any | null>;
export declare function writeManifest(projectDir: string, recipe: ScaffoldRecipe, files: Map<string, unknown>): Promise<string>;
