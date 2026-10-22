import type { Block } from './blocks';
import { field, fieldProblems, validateValue, type FieldDeclaration } from './fields';

/**
 * Who may perform an action.
 * - `public`: anyone, including anonymous visitors.
 * - `authenticated`: any signed-in user.
 * - `owner`: the user who created the record (requires `ownership`).
 * - `{ permission }`: users whose roles grant the permission.
 * - `{ where }`: anyone, on records whose fields equal these values, such as published posts.
 * - `{ any: [...] }`: the first rule that allows wins; owner and where rules combine.
 * - `none`: nobody, except the system principal.
 */
export type AccessRule = 'public' | 'authenticated' | 'owner' | 'none' | { readonly permission: string }
    | { readonly where: { readonly [field: string]: string | number | boolean } } | { readonly any: readonly AccessRule[] };

export type ResourceAction = 'read' | 'create' | 'update' | 'delete';

export type ResourceAccess = { readonly [A in ResourceAction]?: AccessRule };

export interface IndexDeclaration {
    readonly name: string;
    readonly fields: readonly string[];
    readonly unique?: boolean;
}

/** Explicit, versioned schema change. Generated upgrades are additive; these run once each, in version order. */
export type MigrationStep =
    /** Set a value where the field is missing or null. */
    | { readonly version: number; readonly kind: 'backfill'; readonly field: string; readonly value: string | number | boolean }
    /** Copy one field into another where the target is missing. Keep the old field declared until a later `drop`. */
    | { readonly version: number; readonly kind: 'rename'; readonly from: string; readonly to: string }
    /** Apply the declaration's stricter definition of a field (required, check). Fails while records violate it. */
    | { readonly version: number; readonly kind: 'tighten'; readonly field: string }
    /** Remove a field that the declaration no longer lists, from every record and the schema. */
    | { readonly version: number; readonly kind: 'drop'; readonly field: string };

export interface ResourceDeclaration {
    /** Lowercase name, unique within its owner, such as `posts`. */
    readonly name: string;
    /** Owner namespace: `cms`, `app` or a plugin name. Assigned by the host when omitted. */
    readonly owner?: string;
    readonly label?: string;
    /** Field shown as the record title in the dashboard. */
    readonly titleField?: string;
    readonly fields: { readonly [name: string]: FieldDeclaration };
    readonly indexes?: readonly IndexDeclaration[];
    readonly access?: ResourceAccess;
    /** Record the creating user and enable `owner` rules. */
    readonly ownership?: boolean;
    /** Keep a revision snapshot of every write. Default true. */
    readonly revisions?: boolean;
    /**
     * Store records in a document table without `STRICT`: only system fields are typed in the
     * database and the host validates the declared fields. Adding or changing a field needs no
     * DDL, only index changes. Collections use this.
     */
    readonly schemaless?: boolean;
    readonly migrations?: readonly MigrationStep[];
    /**
     * The field groups' blocks that lay the fields out, for the conditions on them: a field a
     * condition hides is not required and is cleared on write. Set by the host for collections.
     */
    readonly layout?: readonly Block[];
}

export interface Resource extends ResourceDeclaration {
    readonly owner: string;
    /** `owner/name`. */
    readonly id: string;
    /** FastDB collection that stores the records. */
    readonly storage: string;
    readonly access: { readonly [A in ResourceAction]: AccessRule };
    readonly ownership: boolean;
    readonly revisions: boolean;
    readonly schemaless: boolean;
    readonly indexes: readonly IndexDeclaration[];
    readonly migrations: readonly MigrationStep[];
}

export const RESOURCE_NAME = /^[a-z][a-z0-9_]{0,40}$/;
export const OWNER_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Host fields on every resource record, stored next to the declared fields. */
export const SYSTEM_FIELDS = ['_rev', '_op', '_createdAt', '_updatedAt', '_owner'] as const;

export class ResourceDeclarationError extends Error {
    readonly problems: readonly string[];
    constructor(resource: string, problems: readonly string[]) {
        super(`Invalid resource ${resource}: ${problems.join(' ')}`);
        this.name = 'ResourceDeclarationError';
        this.problems = problems;
    }
}

/** Declare a resource. The declaration is plain data, so it can travel in a plugin manifest. */
export function defineResource<const D extends ResourceDeclaration>(declaration: D): D {
    const problems = resourceProblems(declaration);
    if (problems.length) throw new ResourceDeclarationError(declaration.name ?? '(unnamed)', problems);
    return declaration;
}

export { field };

export function resourceProblems(declaration: ResourceDeclaration): string[] {
    const problems: string[] = [];
    if (typeof declaration?.name !== 'string' || !RESOURCE_NAME.test(declaration.name) || declaration.name.includes('__')) problems.push('name must be lowercase letters, digits and single underscores, starting with a letter.');
    if (declaration.owner !== undefined && (!OWNER_NAME.test(declaration.owner) || declaration.owner.length > 64)) problems.push('owner must be a plugin name.');
    if (!declaration.fields || typeof declaration.fields !== 'object') return [...problems, 'fields are required.'];
    const names = Object.keys(declaration.fields);
    if (!names.length) problems.push('declare at least one field.');
    // Field groups and their derived lists add up on a collection.
    const limit = declaration.schemaless ? 160 : 24;
    if (names.length > limit) problems.push(`declare at most ${limit} fields per resource.`);
    const lower = new Set<string>();
    for (const name of names) {
        if (lower.has(name.toLowerCase())) problems.push(`field ${name} differs from another field only by case.`);
        lower.add(name.toLowerCase());
        problems.push(...fieldProblems(name, declaration.fields[name]!));
    }
    if (declaration.titleField !== undefined && !names.includes(declaration.titleField)) problems.push(`titleField ${declaration.titleField} is not a declared field.`);
    for (const name of names) {
        const from = declaration.fields[name]!.slugFrom;
        if (from !== undefined && !['string', 'text'].includes(declaration.fields[from]?.kind as string)) problems.push(`field ${name}: slugFrom ${from} is not a declared string or text field.`);
    }
    const searchable = names.filter(name => declaration.fields[name]!.search);
    if (searchable.length > 16) problems.push('at most 16 fields can be searched.');
    const indexNames = new Set<string>();
    for (const index of declaration.indexes ?? []) {
        if (!/^[a-z][a-z0-9_]{0,40}$/.test(index.name) || indexNames.has(index.name)) problems.push(`index ${index.name} needs a unique lowercase name.`);
        indexNames.add(index.name);
        if (!index.fields?.length || index.fields.length > 4) problems.push(`index ${index.name} needs 1-4 fields.`);
        for (const name of index.fields ?? []) {
            const declared = declaration.fields[name];
            if (!declared && !(['_createdAt', '_updatedAt', '_owner'] as string[]).includes(name)) problems.push(`index ${index.name} names undeclared field ${name}.`);
            else if (declared && ['json', 'list', 'vector', 'text'].includes(declared.kind)) problems.push(`index ${index.name} cannot include ${declared.kind} field ${name}.`);
        }
    }
    for (const action of Object.keys(declaration.access ?? {})) {
        if (!['read', 'create', 'update', 'delete'].includes(action)) problems.push(`access.${action} is not an action.`);
        else problems.push(...ruleProblems(`access.${action}`, declaration.access![action as ResourceAction]!, declaration.ownership === true, declaration.fields));
    }
    const versions = new Set<number>();
    // Steps written before a later drop may name the dropped field.
    const droppedAfter = (name: string, version: number) => (declaration.migrations ?? []).some(step => step.kind === 'drop' && step.field === name && step.version > version);
    const known = (name: string, version: number) => Boolean(declaration.fields[name]) || droppedAfter(name, version);
    for (const step of declaration.migrations ?? []) {
        if (!Number.isSafeInteger(step.version) || step.version < 1 || versions.has(step.version)) problems.push('migration versions must be distinct positive integers.');
        versions.add(step.version);
        if (step.kind === 'backfill' || step.kind === 'tighten') {
            if (!known(step.field, step.version)) problems.push(`migration ${step.version}: ${step.kind} names undeclared field ${step.field}.`);
        } else if (step.kind === 'rename') {
            if (!known(step.from, step.version) || !known(step.to, step.version)) problems.push(`migration ${step.version}: rename needs both ${step.from} and ${step.to} declared until a later drop.`);
            else if (declaration.fields[step.from] && declaration.fields[step.to] && declaration.fields[step.from]!.kind !== declaration.fields[step.to]!.kind) problems.push(`migration ${step.version}: rename needs fields of the same kind.`);
        } else if (step.kind === 'drop') {
            if (declaration.fields[step.field]) problems.push(`migration ${step.version}: drop names ${step.field}, which is still declared.`);
            if (!/^[a-z][a-zA-Z0-9]{0,62}$/.test(step.field)) problems.push(`migration ${step.version}: drop needs a field name.`);
        } else problems.push(`migration ${(step as { version: number }).version}: unknown kind.`);
    }
    return problems;
}

function ruleProblems(at: string, rule: AccessRule, ownership: boolean, fields: ResourceDeclaration['fields'], depth = 0): string[] {
    if (depth > 4) return [`${at}: rules nest too deeply.`];
    if (rule === 'public' || rule === 'authenticated' || rule === 'none') return [];
    if (rule === 'owner') return ownership ? [] : [`${at}: owner rules need ownership: true.`];
    if (typeof rule === 'object' && rule && 'permission' in rule) return /^[a-z][a-z0-9:/._*-]{0,127}$/.test(rule.permission) ? [] : [`${at}: invalid permission ${rule.permission}.`];
    if (typeof rule === 'object' && rule && 'where' in rule && rule.where && typeof rule.where === 'object') {
        const entries = Object.entries(rule.where);
        if (!entries.length || entries.length > 4) return [`${at}: where rules name 1-4 fields.`];
        return entries.flatMap(([name, value]) => {
            const declared = fields[name];
            if (!declared || !['string', 'enum', 'integer', 'boolean'].includes(declared.kind)) return [`${at}: where names ${name}, which is not a declared string, enum, integer or boolean field.`];
            const error = validateValue(name, declared, value);
            return error ? [`${at}: where ${name} ${error}`] : [];
        });
    }
    if (typeof rule === 'object' && rule && 'any' in rule && Array.isArray(rule.any) && rule.any.length) return rule.any.flatMap(entry => ruleProblems(at, entry, ownership, fields, depth + 1));
    return [`${at}: unknown rule.`];
}

/** Collection name for a resource: `r__<owner>__<name>`, with hyphens as underscores. Injective for valid names. */
export function storageName(owner: string, name: string): string {
    return `r__${owner.replaceAll('-', '_')}__${name}`;
}

/** Permission for an action on a resource: `cms/posts:update`. */
export function permissionFor(resourceId: string, action: ResourceAction): string {
    return `${resourceId}:${action}`;
}

/** Normalize a declaration for the host: owner, ID, storage name and default rules. */
export function resolveResource(declaration: ResourceDeclaration, owner = declaration.owner ?? 'app'): Resource {
    const problems = resourceProblems({ ...declaration, owner });
    if (problems.length) throw new ResourceDeclarationError(`${owner}/${declaration.name}`, problems);
    const id = `${owner}/${declaration.name}`;
    const access = Object.fromEntries((['read', 'create', 'update', 'delete'] as const).map(action =>
        [action, declaration.access?.[action] ?? { permission: permissionFor(id, action) }])) as Resource['access'];
    return Object.freeze({
        ...declaration,
        owner,
        id,
        storage: storageName(owner, declaration.name),
        access,
        ownership: declaration.ownership === true,
        revisions: declaration.revisions !== false,
        schemaless: declaration.schemaless === true,
        indexes: declaration.indexes ?? [],
        migrations: [...(declaration.migrations ?? [])].sort((a, b) => a.version - b.version),
    });
}

/** Canonical JSON with sorted keys, for hashing declarations. */
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    return `{${Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined)
        .map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

/** SHA-256 of the canonical declaration, recorded in the migration ledger. */
export async function declarationHash(resource: Resource): Promise<string> {
    const { storage: _storage, ...declaration } = resource;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(declaration)));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
