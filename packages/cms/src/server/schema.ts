/**
 * Schema planner. Reads the live catalog through INFO, diffs it against resource
 * declarations and plans additive DDL; renames, backfills, tightened constraints and
 * drops are explicit versioned steps. Each step is one atomic batch sent with
 * `ifSequence` from the planning read, recorded in the relational migration ledger.
 */
import { indexedRowPaths, rowIndexPath, rowsSearchable } from '../field-groups';
import { ClientError, compareVersions, encodeValue, type RomeDB, type Statement, type Value } from '@cossackframework/romedb';
import { storageCheck, storageType, type FieldDeclaration } from '../fields';
import { declarationHash, SYSTEM_FIELDS, type MigrationStep, type Resource } from '../resource';
import { HOST_STEPS, HOST_TABLES, type HostStep } from './host-schema';

export interface FieldSpec {
    readonly name: string;
    readonly type: string;
    readonly elementType: string | null;
    readonly required: boolean;
    readonly nullable: boolean;
    readonly hasDefault: boolean;
    readonly default: Value;
    readonly check: string | null;
    readonly flexible: boolean;
}

export interface IndexSpec {
    readonly name: string;
    readonly kind: 'scalar' | 'fulltext' | 'array';
    readonly paths: readonly string[];
    readonly unique: boolean;
}

export interface CollectionSpec {
    readonly resource: Resource;
    readonly name: string;
    readonly fields: readonly FieldSpec[];
    readonly indexes: readonly IndexSpec[];
}

export interface CatalogField {
    path: string[];
    type: string;
    element_type: string | null;
    required: boolean;
    nullable: boolean;
    has_default: boolean;
    default: Value;
    check: string | null;
    flexible: boolean;
}

export interface CatalogTable {
    name: string;
    model: string;
    strict?: boolean;
    fields?: CatalogField[];
    indexes?: { name: string; kind: string; paths?: string[][]; path?: string[]; unique: boolean }[];
}

export interface LedgerState {
    /** Applied host step versions. */
    host: Set<number>;
    /** Applied explicit steps by resource ID. */
    explicit: Map<string, Set<number>>;
    /** Declaration hash recorded by the latest step of each resource. */
    hashes: Map<string, string>;
}

export interface Catalog {
    readonly sequence: number;
    readonly engineVersion: string;
    readonly tables: ReadonlyMap<string, CatalogTable>;
    readonly ledger: LedgerState;
}

export interface PlannedStep {
    /** Ledger ID: unique per step. Explicit and host steps reuse theirs, so they apply once. */
    readonly id: string;
    readonly resource: string | null;
    readonly owner: string;
    readonly kind: 'host' | 'additive' | 'explicit';
    readonly version: number;
    readonly description: string;
    readonly statements: readonly Statement[];
    readonly declarationHash: string | null;
}

export interface SchemaProblem {
    readonly resource: string;
    readonly field?: string;
    readonly message: string;
}

export interface SchemaPlan {
    readonly sequence: number;
    readonly engineVersion: string;
    readonly steps: readonly PlannedStep[];
    /** Changes the planner will not make: a resource with a blocked change is not migrated. */
    readonly blocked: readonly SchemaProblem[];
    readonly warnings: readonly SchemaProblem[];
    /** Resources whose catalog and ledger match their declaration. */
    readonly current: readonly string[];
}

export interface MigrationReport {
    readonly applied: readonly PlannedStep[];
    readonly failed?: { readonly step: PlannedStep; readonly code: string; readonly message: string };
    readonly blocked: readonly SchemaProblem[];
    readonly warnings: readonly SchemaProblem[];
    readonly replans: number;
}

const MAX_STEP_STATEMENTS = 28;
/** The first RomeDB release that indexes paths into arrays of objects, as `team.*.kind`. */
export const ROW_INDEX_ENGINE_VERSION = '0.2.11';
const quote = (name: string) => `"${name}"`;
const literal = (value: string | number | boolean | null): string =>
    value === null ? 'NULL' : typeof value === 'string' ? `'${value.replaceAll("'", "''")}'` : String(value);

/** The collection a resource declaration requires. Deterministic for a declaration. */
export function collectionSpec(resource: Resource, storageOf: (resourceId: string) => string): CollectionSpec {
    const system: FieldSpec[] = [
        spec('_rev', { kind: 'integer', required: true, min: 1 }, storageOf),
        spec('_op', { kind: 'string', required: true, max: 80 }, storageOf),
        spec('_createdAt', { kind: 'datetime', required: true }, storageOf),
        spec('_updatedAt', { kind: 'datetime', required: true }, storageOf),
        spec('_owner', { kind: 'string', nullable: true, max: 80 }, storageOf),
    ];
    // Schemaless collections type only the system fields; the host validates the rest.
    const declared = resource.schemaless ? [] : Object.entries(resource.fields).flatMap(([name, declaration]) => [
        spec(name, declaration, storageOf),
        // A searchable rich text, blocks or multiple field keeps its plain text beside the document.
        ...(searchedAsText(declaration) ? [spec(searchTextPath(name), { kind: 'text', nullable: true }, storageOf)] : []),
    ]);
    const indexes: IndexSpec[] = [{ name: `${resource.storage}___updated`, kind: 'scalar', paths: ['_updatedAt'], unique: false }];
    if (resource.ownership) indexes.push({ name: `${resource.storage}___owner`, kind: 'scalar', paths: ['_owner'], unique: false });
    for (const [name, declaration] of Object.entries(resource.fields)) {
        if (declaration.unique) indexes.push({ name: `${resource.storage}__u_${name.toLowerCase()}`, kind: 'scalar', paths: [name], unique: true });
        else if (declaration.index || declaration.kind === 'reference') indexes.push({ name: `${resource.storage}__${name.toLowerCase()}`, kind: declaration.multiple ? 'array' : 'scalar', paths: [name], unique: false });
    }
    // A row field's index steps into every row of each rows field above it.
    for (const path of indexedRowPaths(resource.fields)) indexes.push({ name: `${resource.storage}__r_${path.join('__').toLowerCase()}`, kind: 'array', paths: [rowIndexPath(path)], unique: false });
    for (const index of resource.indexes) indexes.push({ name: `${resource.storage}__i_${index.name}`, kind: 'scalar', paths: [...index.fields], unique: index.unique === true });
    const searchable = Object.entries(resource.fields).filter(([, declaration]) => declaration.search || rowsSearchable(declaration))
        .map(([name, declaration]) => searchedAsText(declaration) ? searchTextPath(name) : name);
    if (searchable.length) indexes.push({ name: `${resource.storage}__text`, kind: 'fulltext', paths: searchable, unique: false });
    return { resource, name: resource.storage, fields: [...system, ...declared], indexes };
}

function spec(name: string, declaration: FieldDeclaration, storageOf: (resourceId: string) => string): FieldSpec {
    const type = storageType(declaration, storageOf);
    const array = /^array<(.+)>$/.exec(type);
    return {
        name,
        type: array ? 'array' : type,
        elementType: array ? array[1]! : null,
        required: declaration.required === true,
        nullable: declaration.nullable === true,
        hasDefault: declaration.default !== undefined,
        default: declaration.default === undefined ? null : declaration.default as Value,
        check: storageCheck(quote(name), declaration) ?? null,
        flexible: declaration.kind === 'json' || declaration.kind === 'richtext',
    };
}

/** Where a searchable rich text or blocks field's plain text is stored, for the full-text index. */
export function searchTextPath(field: string): string {
    return `_text_${field}`;
}

/** Whether a field is searched through its plain text beside the document: rich text, blocks, rows and multiple fields. */
export function searchedAsText(declaration: FieldDeclaration): boolean {
    return (declaration.search === true && (declaration.kind === 'richtext' || declaration.kind === 'blocks' || declaration.multiple === true)) || rowsSearchable(declaration);
}

/** `DEFINE FIELD` for a spec; `overwrite` replaces an existing definition. */
export function defineFieldRql(collection: string, field: FieldSpec, options: { overwrite?: boolean; optional?: boolean } = {}): string {
    let rql = `DEFINE FIELD ${options.overwrite ? 'OVERWRITE ' : ''}${quote(field.name)} ON ${collection} TYPE ${field.elementType ? `array<${field.elementType}>` : field.type}`;
    if (field.required && !options.optional) rql += ' REQUIRED';
    if (field.nullable) rql += ' NULLABLE';
    if (field.flexible) rql += ' FLEXIBLE';
    if (field.hasDefault) rql += ` DEFAULT ${literal(field.default as string | number | boolean | null)}`;
    if (field.check) rql += ` CHECK(${field.check})`;
    return rql;
}

export function indexRql(collection: string, index: IndexSpec): string {
    const paths = index.paths.map(indexPath).join(', ');
    if (index.kind === 'fulltext') return `CREATE SEARCH INDEX ${index.name} ON ${collection}(${paths}) USING FULLTEXT`;
    // One entry per element, so `array::contains(field, $value)` seeks.
    if (index.kind === 'array') return `CREATE SEARCH INDEX ${index.name} ON ${collection}(${paths}) USING ARRAY`;
    return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${index.name} ON ${collection} (${paths})`;
}

/** An index path with each field quoted: `team.*.kind` becomes `"team".*."kind"`. */
function indexPath(path: string): string {
    return path.split('.').map(part => part === '*' ? part : quote(part)).join('.');
}

/** Read the catalog in one snapshot sequence. Retries when a write lands between the reads. */
export async function readCatalog(db: RomeDB, collections: readonly string[], options: { signal?: AbortSignal } = {}): Promise<Catalog> {
    for (let attempt = 0; attempt < 5; attempt++) {
        const first = await db.read([{ rql: 'INFO FOR DB' }], options);
        const info = first.results[0]!.rows[0]![0] as { tables?: { name: string; model: string }[] };
        const names = new Map((info.tables ?? []).map(table => [table.name, table.model]));
        const wanted = collections.filter(name => names.get(name) === 'document');
        const statements: Statement[] = wanted.map(name => ({ rql: `INFO FOR TABLE ${name}` }));
        const ledgerQueries = names.has('cms_migrations') && names.has('cms_schema_state');
        if (ledgerQueries) {
            statements.push({ rql: "SELECT kind, resource, version FROM cms_migrations WHERE kind IN ('host', 'explicit') ORDER BY kind, resource, version" });
            statements.push({ rql: 'SELECT resource, declaration_hash FROM cms_schema_state ORDER BY resource' });
        }
        const tables = new Map<string, CatalogTable>();
        for (const [name, model] of names) tables.set(name, { name, model });
        const ledger: LedgerState = { host: new Set(), explicit: new Map(), hashes: new Map() };
        let consistent = true;
        for (let offset = 0; offset < statements.length; offset += 30) {
            const chunk = statements.slice(offset, offset + 30);
            const result = await db.read(chunk, { ...options, afterSequence: first.sequence });
            if (result.sequence !== first.sequence) { consistent = false; break; }
            chunk.forEach((statement, index) => {
                const rows = result.results[index]!.rows;
                if (statement.rql.startsWith('INFO FOR TABLE ')) {
                    const table = rows[0]![0] as unknown as CatalogTable;
                    tables.set(table.name, table);
                } else if (statement.rql.includes('FROM cms_migrations')) {
                    for (const [kind, resource, version] of rows) {
                        if (kind === 'host') ledger.host.add(Number(version));
                        else {
                            const set = ledger.explicit.get(resource as string) ?? new Set<number>();
                            set.add(Number(version));
                            ledger.explicit.set(resource as string, set);
                        }
                    }
                } else for (const [resource, hash] of rows) ledger.hashes.set(resource as string, hash as string);
            });
        }
        if (!consistent) continue;
        const details = await db.preflight(options);
        return { sequence: first.sequence, engineVersion: details.engineVersion!, tables, ledger };
    }
    throw new Error('The database kept changing while the schema was read; retry the migration.');
}

/** Plan host tables, then each resource in ID order. Pure: the same inputs give the same RomeQL. */
export async function planSchema(resources: readonly Resource[], catalog: Catalog): Promise<SchemaPlan> {
    const steps: PlannedStep[] = [];
    const blocked: SchemaProblem[] = [];
    const warnings: SchemaProblem[] = [];
    const current: string[] = [];
    for (const step of HOST_STEPS) {
        if (catalog.ledger.host.has(step.version)) continue;
        steps.push(hostStep(step));
    }
    const byId = new Map(resources.map(resource => [resource.id, resource]));
    const storageOf = (id: string) => {
        const target = byId.get(id);
        if (!target) throw new Error(`Reference target ${id} is not a registered resource.`);
        return target.storage;
    };
    for (const resource of [...resources].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
        const problems: SchemaProblem[] = [];
        let collection: CollectionSpec;
        try { collection = collectionSpec(resource, storageOf); }
        catch (error) { blocked.push({ resource: resource.id, message: (error as Error).message }); continue; }
        const hash = await declarationHash(resource);
        const table = catalog.tables.get(collection.name);
        const applied = catalog.ledger.explicit.get(resource.id) ?? new Set<number>();
        const resourceSteps: PlannedStep[] = [];
        if (collection.indexes.some(index => index.paths.some(path => path.includes('.*.'))) && compareVersions(catalog.engineVersion, ROW_INDEX_ENGINE_VERSION) < 0) {
            blocked.push({ resource: resource.id, message: `Filterable repeater fields need RomeDB ${ROW_INDEX_ENGINE_VERSION} or later; the database runs ${catalog.engineVersion}.` });
            continue;
        }
        if (table && table.model !== 'document') {
            blocked.push({ resource: resource.id, message: `${collection.name} exists as a ${table.model} table.` });
            continue;
        }
        if (!table) {
            const statements: Statement[] = [{ rql: `CREATE TABLE ${collection.name}` }];
            for (const field of collection.fields) statements.push({ rql: defineFieldRql(collection.name, field) });
            if (!resource.schemaless) statements.push({ rql: `DEFINE SCHEMA ON ${collection.name} STRICT` });
            for (const index of collection.indexes) statements.push({ rql: indexRql(collection.name, index) });
            resourceSteps.push(...chunkSteps(resource, 'additive', 0, `Create ${resource.id}`, statements, hash));
            // A new collection has nothing to migrate; record its explicit steps as applied.
            for (const step of resource.migrations) resourceSteps.push(explicitStep(resource, step, [], hash));
        } else {
            const additive: Statement[] = [];
            const catalogFields = new Map((table.fields ?? []).filter(entry => entry.path.length === 1).map(entry => [entry.path[0]!, entry]));
            const pending = resource.migrations.filter(step => !applied.has(step.version));
            const pendingFor = (kind: MigrationStep['kind'], name: string) => pending.find(step => step.kind === kind && ('field' in step ? step.field === name : false));
            for (const field of collection.fields) {
                const existing = catalogFields.get(field.name);
                if (!existing) {
                    if (field.required && !field.hasDefault) {
                        // Expand first: add the field as optional; a declared tighten step makes it required.
                        additive.push({ rql: defineFieldRql(collection.name, field, { optional: true }) });
                        if (!pendingFor('tighten', field.name)) problems.push({ resource: resource.id, field: field.name, message: `${field.name} is new and required. Declare a backfill (if records exist) and a tighten step, or make it optional.` });
                    } else additive.push({ rql: defineFieldRql(collection.name, field) });
                    continue;
                }
                const drift = fieldDrift(field, existing);
                if (!drift.length) continue;
                const onlyTightening = drift.every(name => ['required', 'check'].includes(name));
                if (onlyTightening && pendingFor('tighten', field.name)) continue;
                problems.push({ resource: resource.id, field: field.name, message: `${field.name} differs from the database in ${drift.join(', ')}. ${onlyTightening ? 'Declare a tighten step.' : 'Add a new field, migrate values, then drop the old field.'}` });
            }
            for (const name of catalogFields.keys()) {
                if (collection.fields.some(field => field.name === name)) continue;
                if (!pendingFor('drop', name)) warnings.push({ resource: resource.id, field: name, message: `${name} is in the database but not declared. Declare a drop step to remove it.` });
            }
            if (table.strict !== true && !resource.schemaless) problems.push({ resource: resource.id, message: `${collection.name} is not a strict collection.` });
            const catalogIndexes = new Map((table.indexes ?? []).map(index => [index.name, index]));
            for (const index of collection.indexes) {
                const existing = catalogIndexes.get(index.name);
                if (!existing) { additive.push({ rql: indexRql(collection.name, index) }); continue; }
                const paths = (existing.paths ?? (existing.path ? [existing.path] : [])).map(path => path.join('.'));
                if (existing.kind !== index.kind || existing.unique !== index.unique || paths.join(',') !== index.paths.join(',')) {
                    // Schemaless collections rebuild a changed index, such as full-text search over a new field; strict ones rename it.
                    if (resource.schemaless) additive.push({ rql: `DROP INDEX ${index.name}` }, { rql: indexRql(collection.name, index) });
                    else problems.push({ resource: resource.id, message: `Index ${index.name} differs from the database. Rename the index to replace it.` });
                }
            }
            for (const name of catalogIndexes.keys()) {
                if (!name.startsWith(`${collection.name}__`) || collection.indexes.some(index => index.name === name)) continue;
                // Dropping an index loses no data; schemaless collections drop the ones they no longer declare.
                if (resource.schemaless) additive.push({ rql: `DROP INDEX ${name}` });
                else warnings.push({ resource: resource.id, message: `Index ${name} is no longer declared.` });
            }
            if (additive.length) resourceSteps.push(...chunkSteps(resource, 'additive', 0, `Extend ${resource.id}`, additive, hash));
            for (const step of pending) {
                const statements = explicitStatements(collection, step, catalogFields, resource.schemaless);
                if (typeof statements === 'string') { problems.push({ resource: resource.id, message: `Migration ${step.version}: ${statements}` }); break; }
                resourceSteps.push(explicitStep(resource, step, statements, hash));
            }
            if (!resourceSteps.length && catalog.ledger.hashes.get(resource.id) !== hash && !problems.length) {
                // Equivalent declaration with a new hash (for example a label change): record it.
                resourceSteps.push(...chunkSteps(resource, 'additive', 0, `Record ${resource.id}`, [], hash));
            }
        }
        if (problems.length) { blocked.push(...problems); continue; }
        if (!resourceSteps.length) current.push(resource.id);
        steps.push(...resourceSteps);
    }
    return { sequence: catalog.sequence, engineVersion: catalog.engineVersion, steps, blocked, warnings, current };
}

/**
 * Apply a plan step by step. A sequence conflict (another write landed) re-plans from a
 * fresh catalog read; any other failure stops, leaving earlier steps applied.
 */
export interface MigrateOptions {
    signal?: AbortSignal;
    maxReplans?: number;
    now?: () => number;
    /** Apply host steps and only these resources' steps. */
    only?: readonly string[];
    /** Statements committed with the last step of a resource, such as its stored definition. */
    attach?: (resource: string) => readonly Statement[];
}

export async function migrate(db: RomeDB, resources: readonly Resource[], options: MigrateOptions = {}): Promise<MigrationReport> {
    const applied: PlannedStep[] = [];
    const now = options.now ?? Date.now;
    let replans = 0;
    for (;;) {
        const catalog = await readCatalog(db, resources.map(resource => resource.storage), options);
        const plan = await planSchema(resources, catalog);
        let sequence = plan.sequence;
        let conflict = false;
        const steps = options.only ? plan.steps.filter(step => step.resource === null || options.only!.includes(step.resource)) : plan.steps;
        const last = new Map(steps.filter(step => step.resource).map(step => [step.resource!, step]));
        for (const step of steps) {
            try {
                const attached = step.resource && last.get(step.resource) === step ? options.attach?.(step.resource) ?? [] : [];
                const result = await db.write([...step.statements, ...ledgerStatements(step, plan.engineVersion, now()), ...attached], {
                    afterSequence: sequence, ifSequence: sequence, kind: 'cms.migration', signal: options.signal,
                    workLimits: { rowsRead: 1_000_000, rowMutations: 100_000, vmSteps: 10_000_000 },
                });
                sequence = result.sequence;
                applied.push(step);
            } catch (error) {
                if (error instanceof ClientError && error.outcome === 'rolled-back' && isSequenceConflict(error)) { conflict = true; break; }
                const code = error instanceof ClientError ? error.code : (error as Error).name;
                return { applied, failed: { step, code, message: (error as Error).message }, blocked: plan.blocked, warnings: plan.warnings, replans };
            }
        }
        if (!conflict) return { applied, blocked: plan.blocked, warnings: plan.warnings, replans };
        if (++replans > (options.maxReplans ?? 3)) throw new Error('Schema migration kept conflicting with other writes; retry later.');
    }
}

function isSequenceConflict(error: ClientError): boolean {
    return error.code === 'FDB_CONFLICT' || /sequence/i.test(error.message);
}

function fieldDrift(desired: FieldSpec, existing: CatalogField): string[] {
    const drift: string[] = [];
    if (desired.type !== existing.type) drift.push('type');
    if ((desired.elementType ?? null) !== (existing.element_type ?? null)) drift.push('item type');
    if (desired.required !== existing.required) drift.push('required');
    if (desired.nullable !== existing.nullable) drift.push('nullable');
    if (desired.flexible !== existing.flexible) drift.push('flexible');
    if (desired.hasDefault !== existing.has_default || (desired.hasDefault && JSON.stringify(encodeValue(desired.default)) !== JSON.stringify(encodeValue(existing.default)))) {
        // Number fields keep integral defaults as integers; compare by value.
        if (!(desired.hasDefault && existing.has_default && sameNumber(desired.default, existing.default))) drift.push('default');
    }
    if ((desired.check ?? null) !== (existing.check ?? null)) drift.push('check');
    return drift;
}

function sameNumber(a: Value, b: Value): boolean {
    const number = (value: Value) => typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : value && typeof value === 'object' && 'value' in value && typeof value.value === 'number' ? value.value : NaN;
    return number(a) === number(b);
}

function explicitStatements(collection: CollectionSpec, step: MigrationStep, catalog: Map<string, CatalogField>, schemaless: boolean): Statement[] | string {
    const table = collection.name;
    if (schemaless) {
        // Only stored values change; the host validates the declared fields.
        switch (step.kind) {
            case 'backfill': return [{ rql: `UPDATE ${table} SET ${quote(step.field)} = $value WHERE ${quote(step.field)} IS NULL`, params: { $value: step.value } }];
            case 'rename': return [{ rql: `UPDATE ${table} SET ${quote(step.to)} = ${quote(step.from)} WHERE ${quote(step.to)} IS NULL AND ${quote(step.from)} IS NOT NULL` }];
            case 'tighten': return [];
            case 'drop': return [{ rql: `UPDATE ${table} UNSET ${quote(step.field)} WHERE ${quote(step.field)} IS NOT NULL` }];
        }
    }
    switch (step.kind) {
        case 'backfill':
            if (!catalog.has(step.field) && !collection.fields.some(field => field.name === step.field)) return `${step.field} does not exist.`;
            return [{ rql: `UPDATE ${table} SET ${quote(step.field)} = $value WHERE ${quote(step.field)} IS NULL`, params: { $value: step.value } }];
        case 'rename':
            return [{ rql: `UPDATE ${table} SET ${quote(step.to)} = ${quote(step.from)} WHERE ${quote(step.to)} IS NULL AND ${quote(step.from)} IS NOT NULL` }];
        case 'tighten': {
            const field = collection.fields.find(entry => entry.name === step.field);
            if (!field) return `${step.field} is not declared.`;
            return [{ rql: defineFieldRql(table, field, { overwrite: true }) }];
        }
        case 'drop': {
            const existing = catalog.get(step.field);
            if (!existing) return [];
            // Relax the definition first, so removing values cannot violate it.
            const type = existing.element_type ? `array<${existing.element_type}>` : existing.type;
            return [
                { rql: `DEFINE FIELD OVERWRITE ${quote(step.field)} ON ${table} TYPE ${type} NULLABLE${existing.flexible ? ' FLEXIBLE' : ''}` },
                { rql: `UPDATE ${table} UNSET ${quote(step.field)} WHERE ${quote(step.field)} IS NOT NULL` },
                { rql: `REMOVE FIELD ${quote(step.field)} ON ${table}` },
            ];
        }
    }
}

function explicitStep(resource: Resource, step: MigrationStep, statements: Statement[], hash: string): PlannedStep {
    return {
        id: `${resource.id}#${step.version}`, resource: resource.id, owner: resource.owner, kind: 'explicit', version: step.version,
        description: `${step.kind} ${'field' in step ? step.field : `${step.from} to ${step.to}`} on ${resource.id}`,
        statements, declarationHash: hash,
    };
}

function chunkSteps(resource: Resource, kind: 'additive', version: number, description: string, statements: Statement[], hash: string): PlannedStep[] {
    const chunks: Statement[][] = [];
    for (let offset = 0; offset < statements.length; offset += MAX_STEP_STATEMENTS) chunks.push(statements.slice(offset, offset + MAX_STEP_STATEMENTS));
    if (!chunks.length) chunks.push([]);
    return chunks.map((chunk, index) => ({
        id: `${resource.id}@${hash.slice(0, 16)}:${index}`, resource: resource.id, owner: resource.owner, kind, version,
        description: chunks.length > 1 ? `${description} (${index + 1}/${chunks.length})` : description, statements: chunk, declarationHash: hash,
    }));
}

function hostStep(step: HostStep): PlannedStep {
    return { id: `cms#host-${step.version}`, resource: null, owner: 'cms', kind: 'host', version: step.version, description: step.description, statements: step.statements, declarationHash: null };
}

/**
 * Ledger rows written in the same batch as the step. Additive step IDs embed the
 * declaration hash and chunk, so re-planning the same declaration cannot record twice.
 */
function ledgerStatements(step: PlannedStep, engineVersion: string, now: number): Statement[] {
    const statements: Statement[] = [{
        rql: 'INSERT INTO cms_migrations (id, kind, owner, resource, version, declaration_hash, rql, engine_version, applied_at) VALUES ($id, $kind, $owner, $resource, $version, $hash, $rql, $engine, $at)',
        params: {
            $id: step.kind === 'additive' ? `${step.id}:${now}` : step.id, $kind: step.kind, $owner: step.owner, $resource: step.resource, $version: step.version,
            $hash: step.declarationHash, $rql: step.statements.map(statement => statement.rql).join(';\n'), $engine: engineVersion, $at: now,
        },
    }];
    if (step.resource) statements.push({
        rql: 'INSERT INTO cms_schema_state (resource, declaration_hash, updated_at) VALUES ($resource, $hash, $at) ON CONFLICT (resource) DO UPDATE SET declaration_hash = excluded.declaration_hash, updated_at = excluded.updated_at',
        params: { $resource: step.resource, $hash: step.declarationHash, $at: now },
    });
    return statements;
}

export { HOST_TABLES, SYSTEM_FIELDS };
