/** Pure recipe metadata without Node ambient types. */
import type { CapabilityDiagnostic } from '@cossackframework/core/runtime-capabilities';

export type Adapter = 'cloudflare' | 'node';
export type Preset = 'minimal' | 'database' | 'auth' | 'full-stack';
export type Feature = 'ui' | 'database' | 'studio' | 'auth' | 'dashboard' | 'markdown' | 'examples' | 'desktop' | 'resource' | 'mutation' | 'scoped-service' | 'protected-route' | 'jobs' | 'turnstile' | 'schedules' | 'notifications' | 'workflows';
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
/** Why `name` cannot be a project (package and Cloudflare Worker) name, or null when it can. */
export declare function projectNameProblem(name: string): string | null;
export declare function resolveFeatures(features: Feature[] | string): Feature[];
export declare function removeFeature(features: Feature[] | string, feature: Feature): Feature[];
export declare function resolveDashboardModules(value: DashboardModule[] | string | undefined, dashboardSelected: boolean): DashboardModule[];
export declare function resolveRecipe(options?: CreateAppOptions): ScaffoldRecipe;

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
