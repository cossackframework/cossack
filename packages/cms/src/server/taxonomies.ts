/**
 * Taxonomies: categories, tags and plugin vocabularies as rows of `cms_terms`. Each term
 * stores the path of ancestor IDs (`/a/b/`), so a subtree is one prefix match, a move is
 * one UPDATE of that prefix, and a delete moves the children to the parent in the same
 * batch. Records hold term IDs in indexed arrays.
 */
import { ClientError, type FastDB, type Statement, type Value } from '@cossackframework/fastdb';
import { CmsError } from '../errors';
import { slugify } from '../fields';
import { hasPermission, PERMISSIONS, type Principal } from '../permissions';
import type { TaxonomyDeclaration, TermShape } from '../taxonomy';
import { containsPattern, inList } from './users';

export type { TaxonomyDeclaration, TermShape };

/** Where records reference a taxonomy: one indexed array field of a resource collection. */
export interface TermUsage {
    readonly resource: string;
    readonly storage: string;
    readonly field: string;
}

export interface TermInput {
    readonly name?: string;
    readonly slug?: string;
    readonly description?: string;
    /** Parent term ID, or null for a top-level term. Hierarchical taxonomies only. */
    readonly parent?: string | null;
}

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WRITE = { kind: 'cms.terms', retryConflicts: 5 } as const;
const COLUMNS = 'id, taxonomy, name, slug, description, parent_id, path, depth, created_at, updated_at';
const MAX_TERMS = 1000;

export class CmsTaxonomies {
    readonly #db: FastDB;
    readonly #now: () => number;
    readonly #taxonomies: () => ReadonlyMap<string, TaxonomyDeclaration>;
    readonly #usage: (taxonomy: string) => readonly TermUsage[];
    readonly #canAssign: (principal: Principal, taxonomy: TaxonomyDeclaration) => boolean;
    readonly #slugChanged: ((taxonomy: TaxonomyDeclaration, from: string, to: string, guard: { sql: string; params: { [key: string]: Value } }) => Statement[]) | undefined;

    constructor(db: FastDB, options: {
        /** Current declarations: built-in and those defined in the dashboard. */
        taxonomies: () => ReadonlyMap<string, TaxonomyDeclaration>;
        usage: (taxonomy: string) => readonly TermUsage[];
        /** Whether the principal may write records that use the taxonomy (to add tags while editing). */
        canAssign: (principal: Principal, taxonomy: TaxonomyDeclaration) => boolean;
        /** Statements to add when a term's slug changes, such as a redirect, run only when `guard` holds. */
        slugChanged?: (taxonomy: TaxonomyDeclaration, from: string, to: string, guard: { sql: string; params: { [key: string]: Value } }) => Statement[];
        now?: () => number;
    }) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
        this.#taxonomies = options.taxonomies;
        this.#usage = options.usage;
        this.#canAssign = options.canAssign;
        this.#slugChanged = options.slugChanged;
    }

    get declarations(): readonly TaxonomyDeclaration[] { return [...this.#taxonomies().values()]; }

    declaration(name: string): TaxonomyDeclaration {
        const taxonomy = this.#taxonomies().get(name);
        if (!taxonomy) throw new CmsError('CMS_NOT_FOUND', `Unknown taxonomy ${name}.`);
        return taxonomy;
    }

    /** Where records use the taxonomy. */
    usage(taxonomy: string): readonly TermUsage[] { return this.#usage(taxonomy); }

    async get(id: string): Promise<TermShape | null> {
        return (await this.getMany([id])).get(id) ?? null;
    }

    async getMany(ids: readonly string[]): Promise<Map<string, TermShape>> {
        const wanted = [...new Set(ids.filter(id => typeof id === 'string' && ID.test(id)))].slice(0, 200);
        if (!wanted.length) return new Map();
        const list = inList('t', wanted);
        const result = await this.#db.read([{ sql: `SELECT ${COLUMNS} FROM cms_terms WHERE id IN ${list.sql}`, params: list.params }]);
        return new Map(result.results[0]!.rows.map(row => { const term = termOf(row); return [term.id, term]; }));
    }

    async bySlug(taxonomy: string, slug: string): Promise<TermShape | null> {
        this.declaration(taxonomy);
        if (!SLUG.test(slug)) return null;
        const result = await this.#db.read([{ sql: `SELECT ${COLUMNS} FROM cms_terms WHERE taxonomy = $taxonomy AND slug = $slug`, params: { $taxonomy: taxonomy, $slug: slug } }]);
        const row = result.results[0]!.rows[0];
        return row ? termOf(row) : null;
    }

    /** Terms by name, with search and pagination. */
    async list(taxonomy: string, options: { search?: string; limit?: number; offset?: number } = {}): Promise<{ items: TermShape[]; total: number }> {
        this.declaration(taxonomy);
        const params: { [key: string]: Value } = { $taxonomy: taxonomy };
        let where = 'taxonomy = $taxonomy';
        if (options.search?.trim()) { where += " AND (lower(name) LIKE $q ESCAPE '\\' OR slug LIKE $q ESCAPE '\\')"; params.$q = containsPattern(options.search.trim().slice(0, 100)); }
        const result = await this.#db.read([
            { sql: `SELECT ${COLUMNS} FROM cms_terms WHERE ${where} ORDER BY lower(name), id LIMIT $limit OFFSET $offset`,
                params: { ...params, $limit: Math.min(Math.max(options.limit ?? 50, 1), 200), $offset: Math.max(options.offset ?? 0, 0) } },
            { sql: `SELECT count(*) FROM cms_terms WHERE ${where}`, params },
        ]);
        return { items: result.results[0]!.rows.map(termOf), total: Number(result.results[1]!.rows[0]![0] as bigint) };
    }

    /** Every term in tree order: each parent before its children, siblings by name. */
    async tree(taxonomy: string): Promise<TermShape[]> {
        this.declaration(taxonomy);
        const result = await this.#db.read([{ sql: `SELECT ${COLUMNS} FROM cms_terms WHERE taxonomy = $taxonomy ORDER BY path LIMIT ${MAX_TERMS}`, params: { $taxonomy: taxonomy } }]);
        const terms = result.results[0]!.rows.map(termOf);
        const children = new Map<string | null, TermShape[]>();
        const known = new Set(terms.map(term => term.id));
        for (const term of terms) {
            const parent = term.parent && known.has(term.parent) ? term.parent : null;
            children.set(parent, [...(children.get(parent) ?? []), term]);
        }
        const ordered: TermShape[] = [];
        const visit = (parent: string | null) => {
            for (const term of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))) {
                ordered.push(term);
                visit(term.id);
            }
        };
        visit(null);
        return ordered;
    }

    /** The term's ancestors, root first. */
    async ancestors(term: TermShape): Promise<TermShape[]> {
        const ids = term.path.split('/').filter(Boolean).slice(0, -1);
        const found = await this.getMany(ids);
        return ids.map(id => found.get(id)).filter((entry): entry is TermShape => entry !== undefined);
    }

    /** The term and every term below it. */
    async subtree(id: string): Promise<string[]> {
        const term = await this.get(id);
        if (!term) return [];
        const result = await this.#db.read([{ sql: `SELECT id FROM cms_terms WHERE taxonomy = $taxonomy AND path LIKE $prefix LIMIT ${MAX_TERMS}`, params: { $taxonomy: term.taxonomy, $prefix: `${term.path}%` } }]);
        return result.results[0]!.rows.map(row => row[0] as string);
    }

    /** Records that reference each term, across the resources that use the taxonomy. */
    async counts(taxonomy: string, ids: readonly string[]): Promise<Map<string, number>> {
        const usage = this.#usage(taxonomy);
        const counts = new Map(ids.map(id => [id, 0]));
        const statements: { id: string; statement: Statement }[] = [];
        for (const id of ids) for (const use of usage) {
            statements.push({ id, statement: { sql: `SELECT count(*) FROM ${use.storage} WHERE array::contains("${use.field}", $term)`, params: { $term: id } } });
        }
        for (let offset = 0; offset < statements.length; offset += 30) {
            const chunk = statements.slice(offset, offset + 30);
            const result = await this.#db.read(chunk.map(entry => entry.statement));
            chunk.forEach((entry, index) => counts.set(entry.id, (counts.get(entry.id) ?? 0) + Number(result.results[index]!.rows[0]![0] as bigint)));
        }
        return counts;
    }

    async create(taxonomy: string, input: TermInput, context: { principal: Principal }): Promise<TermShape> {
        this.#authorize(context.principal);
        const declaration = this.declaration(taxonomy);
        const name = checkName(input.name);
        const parent = await this.#parent(declaration, input.parent ?? null);
        const id = crypto.randomUUID();
        const slug = await this.#uniqueSlug(taxonomy, input.slug?.trim() ? checkSlug(input.slug) : slugify(name, 120) || 'term', null);
        const now = this.#now();
        const params = {
            $id: id, $taxonomy: taxonomy, $name: name, $slug: slug, $description: checkDescription(input.description), $parent: parent?.id ?? null,
            $path: `${parent?.path ?? '/'}${id}/`, $depth: parent ? parent.depth + 1 : 0, $now: now, $parentPath: parent?.path ?? null,
        };
        // A parent that moved or disappeared since it was read inserts nothing.
        const guard = parent ? ' WHERE EXISTS (SELECT 1 FROM cms_terms WHERE id = $parent AND path = $parentPath)' : '';
        const result = await this.#write([bound(`INSERT INTO cms_terms (${COLUMNS}) SELECT $id, $taxonomy, $name, $slug, $description, $parent, $path, $depth, $now, $now${guard}`, params)]);
        if (result.results[0]!.affected !== 1n) throw new CmsError('CMS_CONFLICT', 'The parent changed while the term was saved. Try again.');
        return (await this.get(id))!;
    }

    /** Rename, re-slug, describe or move a term. A move rewrites the subtree's paths in the same batch. */
    async update(id: string, input: TermInput, context: { principal: Principal }): Promise<TermShape> {
        this.#authorize(context.principal);
        const term = await this.get(id);
        if (!term) throw new CmsError('CMS_NOT_FOUND', 'Term not found.');
        const declaration = this.declaration(term.taxonomy);
        const name = input.name === undefined ? term.name : checkName(input.name);
        const slug = input.slug === undefined || input.slug.trim() === term.slug ? term.slug
            : await this.#uniqueSlug(term.taxonomy, input.slug.trim() ? checkSlug(input.slug) : slugify(name, 120) || 'term', id);
        const description = input.description === undefined ? term.description : checkDescription(input.description);
        const now = this.#now();
        const statements: Statement[] = [];
        let path = term.path;
        let parentId = term.parent;
        if (input.parent !== undefined && input.parent !== term.parent) {
            const parent = await this.#parent(declaration, input.parent);
            if (parent && parent.path.startsWith(term.path)) throw new CmsError('CMS_VALIDATION', 'A term cannot move below itself.', { fields: { parent: 'is inside this term.' } });
            path = `${parent?.path ?? '/'}${id}/`;
            parentId = parent?.id ?? null;
            const depth = parent ? parent.depth + 1 : 0;
            const parentGuard = parent ? ' AND EXISTS (SELECT 1 FROM cms_terms p WHERE p.id = $parent AND p.path = $parentPath)' : '';
            // The subtree moves only while its old path and the new parent's path are unchanged.
            statements.push(bound(`UPDATE cms_terms SET path = $path || substr(path, $oldLength + 1), depth = depth + $delta, updated_at = $now
                WHERE taxonomy = $taxonomy AND path LIKE $oldPrefix${parentGuard}`, {
                $path: path, $oldLength: term.path.length, $delta: depth - term.depth, $now: now, $taxonomy: term.taxonomy, $oldPrefix: `${term.path}%`,
                $parent: parent?.id ?? null, $parentPath: parent?.path ?? null,
            }));
        }
        statements.push({ sql: `UPDATE cms_terms SET name = $name, slug = $slug, description = $description, parent_id = $parentId, updated_at = $now WHERE id = $id AND path = $path`,
            params: { $name: name, $slug: slug, $description: description, $parentId: parentId, $now: now, $id: id, $path: path } });
        const own = statements.length - 1;
        if (slug !== term.slug && this.#slugChanged) {
            statements.push(...this.#slugChanged(declaration, term.slug, slug, { sql: 'EXISTS (SELECT 1 FROM cms_terms WHERE id = $tId AND slug = $tSlug AND updated_at = $tNow)', params: { $tId: id, $tSlug: slug, $tNow: now } }));
        }
        const result = await this.#write(statements);
        if (result.results[own]!.affected !== 1n) throw new CmsError('CMS_CONFLICT', 'The term changed while it was saved. Reload and try again.');
        return (await this.get(id))!;
    }

    /**
     * Delete a term. Its children move to its parent in the same batch. Records keep the ID,
     * which readers ignore once the term is gone.
     */
    async delete(id: string, context: { principal: Principal }): Promise<void> {
        this.#authorize(context.principal);
        const term = await this.get(id);
        if (!term) throw new CmsError('CMS_NOT_FOUND', 'Term not found.');
        const parentPath = term.path.slice(0, term.path.slice(0, -1).lastIndexOf('/') + 1);
        const guard = 'EXISTS (SELECT 1 FROM cms_terms t WHERE t.id = $id AND t.path = $path)';
        const params = { $id: id, $path: term.path, $parent: term.parent, $parentPath: parentPath, $length: term.path.length, $prefix: `${term.path}%`, $taxonomy: term.taxonomy, $now: this.#now() };
        const result = await this.#write([
            bound(`UPDATE cms_terms SET parent_id = $parent, updated_at = $now WHERE parent_id = $id AND ${guard}`, params),
            bound(`UPDATE cms_terms SET path = $parentPath || substr(path, $length + 1), depth = depth - 1, updated_at = $now
                WHERE taxonomy = $taxonomy AND path LIKE $prefix AND id != $id AND ${guard}`, params),
            bound('DELETE FROM cms_terms WHERE id = $id AND path = $path', params),
        ]);
        if (result.results[2]!.affected !== 1n) throw new CmsError('CMS_CONFLICT', 'The term changed while it was deleted. Reload and try again.');
    }

    /**
     * Term IDs for names typed into a flat taxonomy's field, creating the missing terms.
     * Anyone who may write a record that uses the taxonomy may add its terms this way.
     */
    async ensure(taxonomy: string, names: readonly string[], context: { principal: Principal }): Promise<string[]> {
        const declaration = this.declaration(taxonomy);
        if (declaration.hierarchical) throw new CmsError('CMS_VALIDATION', `${declaration.label} are chosen, not typed.`);
        const wanted = [...new Map(names.map(name => name.trim()).filter(Boolean).slice(0, 50).map(name => [slugify(name, 120) || name.toLowerCase(), name])).entries()];
        if (!wanted.length) return [];
        const list = inList('s', wanted.map(([slug]) => slug));
        const existing = await this.#db.read([{ sql: `SELECT id, slug FROM cms_terms WHERE taxonomy = $taxonomy AND slug IN ${list.sql}`, params: { $taxonomy: taxonomy, ...list.params } }]);
        const bySlug = new Map(existing.results[0]!.rows.map(row => [row[1] as string, row[0] as string]));
        const missing = wanted.filter(([slug]) => !bySlug.has(slug));
        if (missing.length) {
            if (!this.#canAssign(context.principal, declaration) && !hasPermission(context.principal, PERMISSIONS.manageTerms)) throw new CmsError('CMS_FORBIDDEN', `Not allowed to add ${declaration.label.toLowerCase()}.`);
            const now = this.#now();
            const statements = missing.map(([slug, name]) => {
                const id = crypto.randomUUID();
                bySlug.set(slug, id);
                // A term another request created first wins; its ID is read back below.
                return { sql: `INSERT INTO cms_terms (${COLUMNS}) VALUES ($id, $taxonomy, $name, $slug, '', NULL, $path, 0, $now, $now) ON CONFLICT (taxonomy, slug) DO NOTHING`,
                    params: { $id: id, $taxonomy: taxonomy, $name: checkName(name), $slug: SLUG.test(slug) ? slug : slugify(slug) || `term-${id.slice(0, 8)}`, $path: `/${id}/`, $now: now } };
            });
            await this.#write(statements);
            const again = await this.#db.read([{ sql: `SELECT id, slug FROM cms_terms WHERE taxonomy = $taxonomy AND slug IN ${list.sql}`, params: { $taxonomy: taxonomy, ...list.params } }]);
            for (const row of again.results[0]!.rows) bySlug.set(row[1] as string, row[0] as string);
        }
        return wanted.map(([slug]) => bySlug.get(slug)!).filter(Boolean);
    }

    /** Throw unless every ID is a term of the taxonomy. */
    async assertTerms(taxonomy: string, ids: readonly string[], field: string): Promise<void> {
        this.declaration(taxonomy);
        if (!ids.length) return;
        if (ids.length > 100) throw new CmsError('CMS_VALIDATION', `${field} can hold at most 100 terms.`, { fields: { [field]: 'has too many terms.' } });
        const unique = [...new Set(ids)];
        if (unique.some(id => !ID.test(id))) throw new CmsError('CMS_VALIDATION', `${field} holds an invalid term ID.`, { fields: { [field]: 'holds an invalid term ID.' } });
        const list = inList('t', unique);
        const result = await this.#db.read([{ sql: `SELECT count(*) FROM cms_terms WHERE taxonomy = $taxonomy AND id IN ${list.sql}`, params: { $taxonomy: taxonomy, ...list.params } }]);
        if (Number(result.results[0]!.rows[0]![0] as bigint) !== unique.length) throw new CmsError('CMS_VALIDATION', `${field} names a term that does not exist.`, { fields: { [field]: 'names a missing term.' } });
    }

    #authorize(principal: Principal): void {
        if (!hasPermission(principal, PERMISSIONS.manageTerms)) throw new CmsError(principal.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', 'Not allowed to manage terms.');
    }

    async #parent(taxonomy: TaxonomyDeclaration, id: string | null): Promise<TermShape | null> {
        if (id === null || id === '') return null;
        if (!taxonomy.hierarchical) throw new CmsError('CMS_VALIDATION', `${taxonomy.label} have no parents.`, { fields: { parent: 'is not allowed.' } });
        const parent = await this.get(id);
        if (!parent || parent.taxonomy !== taxonomy.name) throw new CmsError('CMS_VALIDATION', 'The parent term does not exist.', { fields: { parent: 'does not exist.' } });
        if (parent.depth >= 15) throw new CmsError('CMS_LIMIT', 'Terms nest at most 16 levels deep.');
        return parent;
    }

    /** The slug, or the first free `slug-2`, `slug-3`, … in the taxonomy. */
    async #uniqueSlug(taxonomy: string, base: string, except: string | null): Promise<string> {
        const result = await this.#db.read([bound(`SELECT slug FROM cms_terms WHERE taxonomy = $taxonomy AND (slug = $slug OR slug LIKE $prefix ESCAPE '\\')${except ? ' AND id != $except' : ''} LIMIT 1000`,
            { $taxonomy: taxonomy, $slug: base, $prefix: `${base.replace(/[\\%_]/g, character => `\\${character}`)}-%`, $except: except })]);
        return freeSlug(base, result.results[0]!.rows.map(row => row[0] as string));
    }

    async #write(statements: Statement[]) {
        try { return await this.#db.write(statements, WRITE); }
        catch (error) {
            if (error instanceof ClientError && error.outcome === 'rolled-back' && /UNIQUE|constraint/i.test(error.message)) throw new CmsError('CMS_CONFLICT', 'A term with this slug already exists.', { fields: { slug: 'is taken.' } });
            throw error;
        }
    }
}

/** `base`, or `base-N` with the smallest N ≥ 2 not in `taken`. */
export function freeSlug(base: string, taken: readonly string[]): string {
    const used = new Set(taken);
    if (!used.has(base)) return base;
    for (let suffix = 2; ; suffix++) if (!used.has(`${base}-${suffix}`)) return `${base}-${suffix}`;
}

function bound(sql: string, params: { readonly [key: string]: Value }): Statement {
    const used = Object.entries(params).filter(([name]) => new RegExp(`\\${name}(?![A-Za-z0-9_])`).test(sql));
    return used.length ? { sql, params: Object.fromEntries(used) } : { sql };
}

function termOf(row: readonly Value[]): TermShape {
    return Object.freeze({
        id: row[0] as string, taxonomy: row[1] as string, name: row[2] as string, slug: row[3] as string, description: row[4] as string,
        parent: row[5] as string | null, path: row[6] as string, depth: Number(row[7] as bigint), createdAt: Number(row[8] as bigint), updatedAt: Number(row[9] as bigint),
    });
}

function checkName(name: unknown): string {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) throw new CmsError('CMS_VALIDATION', 'Enter a name of at most 120 characters.', { fields: { name: 'is required.' } });
    return name.trim();
}

function checkSlug(slug: string): string {
    const value = slug.trim();
    if (!SLUG.test(value) || value.length > 120) throw new CmsError('CMS_VALIDATION', 'Slugs use lowercase letters, digits and single hyphens.', { fields: { slug: 'has an invalid format.' } });
    return value;
}

function checkDescription(description: unknown): string {
    if (description === undefined || description === null) return '';
    if (typeof description !== 'string' || description.length > 2000) throw new CmsError('CMS_VALIDATION', 'Descriptions can be at most 2000 characters.', { fields: { description: 'is too long.' } });
    return description.trim();
}
