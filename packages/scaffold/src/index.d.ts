export * from './registry.js';
import type { Adapter, CreateAppOptions, DashboardModule, DatabaseProvider, Feature, ScaffoldRecipe } from './registry.js';

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
