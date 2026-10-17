/** Client-safe taxonomy shapes. Terms live in the host's `cms_terms` table. */

export interface TaxonomyDeclaration {
    /** Lowercase name, such as `categories`. */
    readonly name: string;
    readonly label: string;
    /** One term, such as `Category`. */
    readonly singular: string;
    /** Terms can have a parent. */
    readonly hierarchical: boolean;
    /** Public URL base of term archives, such as `category`; null or absent keeps them off the site. */
    readonly path?: string | null;
    readonly description?: string;
    /** Shipped with a module; administrators cannot delete it. */
    readonly builtin?: boolean;
}

/** Problems in a taxonomy declaration; empty when valid. */
export function taxonomyProblems(taxonomy: TaxonomyDeclaration): string[] {
    const problems: string[] = [];
    if (typeof taxonomy?.name !== 'string' || !/^[a-z][a-zA-Z0-9]{0,40}$/.test(taxonomy.name)) problems.push('The name starts with a lowercase letter and uses letters and digits.');
    for (const key of ['label', 'singular'] as const) {
        if (typeof taxonomy?.[key] !== 'string' || !taxonomy[key].trim() || taxonomy[key].length > 60) problems.push(`The ${key === 'label' ? 'plural label' : 'singular label'} must be 1-60 characters.`);
    }
    if (typeof taxonomy?.hierarchical !== 'boolean') problems.push('Choose whether terms nest.');
    if (taxonomy.path !== undefined && taxonomy.path !== null && (typeof taxonomy.path !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(taxonomy.path))) problems.push('The URL path uses lowercase letters, digits and hyphens.');
    if (taxonomy.description !== undefined && (typeof taxonomy.description !== 'string' || taxonomy.description.length > 500)) problems.push('The description can be at most 500 characters.');
    return problems;
}

export interface TermShape {
    readonly id: string;
    readonly taxonomy: string;
    readonly name: string;
    readonly slug: string;
    readonly description: string;
    readonly parent: string | null;
    /** Ancestor IDs and its own, such as `/a/b/`. */
    readonly path: string;
    /** 0 for a top-level term. */
    readonly depth: number;
    readonly createdAt: number;
    readonly updatedAt: number;
}
