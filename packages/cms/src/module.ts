/** What a built-in module ships: resources, taxonomies, settings and its own hook handlers. Client-safe types. */
import type { HookRegistry } from '@cossackframework/core/hooks';
import type { BlockDeclaration } from './blocks';
import type { CollectionDefinition } from './collections';
import type { ResourceDeclaration } from './resource';
import type { SettingsGroup, SiteSettings } from './settings';
import type { TaxonomyDeclaration, TermShape } from './taxonomy';

/** Host services a module's `register` may use. */
export interface ModuleContext {
    readonly hooks: HookRegistry;
    readonly settings: { all(): Promise<SiteSettings> };
    readonly taxonomies: { get(id: string): Promise<TermShape | null> };
    /** A current collection by name, built in or defined in the dashboard. */
    readonly collection: (name: string) => CollectionDefinition | undefined;
    /** Every block type, by name. */
    readonly blocks: () => ReadonlyMap<string, BlockDeclaration>;
    readonly now: () => number;
}

/** A group of resources shipped together, such as the built-in content module. */
export interface CmsModule {
    readonly owner: string;
    readonly resources: readonly ResourceDeclaration[];
    /** Built-in collections, stored as `cms/<name>`. */
    readonly collections?: readonly CollectionDefinition[];
    readonly taxonomies?: readonly TaxonomyDeclaration[];
    readonly blocks?: readonly BlockDeclaration[];
    readonly settings?: readonly SettingsGroup[];
    /** Register the module's filters and actions. Runs once, before plugins. */
    readonly register?: (context: ModuleContext) => void;
}
