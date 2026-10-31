/** JSON-safe public shape of a record. bigint fields are decimal strings; vectors are number arrays. */
export interface RecordShape {
    readonly id: string;
    readonly rev: number;
    readonly createdAt: number;
    readonly updatedAt: number;
    /** User who created the record, for resources with ownership. */
    readonly owner: string | null;
    readonly [field: string]: unknown;
}

export interface RecordPage {
    readonly records: readonly RecordShape[];
    /** Pass as `after` to read the next page; absent on the last page. */
    readonly next?: string;
    /** More records follow, for pages read with `order` or `offset`. */
    readonly more?: boolean;
}

export interface RevisionShape {
    readonly revision: number;
    readonly at: number;
    readonly actor: string | null;
    readonly data: RecordShape;
}

type Scalar = string | number | boolean;

/**
 * A condition on one declared field: a value (or null) for equality, `ne`, `in`, a range for
 * numbers and times, and `contains` / `containsAny` for indexed list fields such as terms.
 */
export type FieldFilter = Scalar | null
    | { readonly ne: Scalar | null }
    | { readonly in: readonly Scalar[] }
    | { readonly gt?: number; readonly gte?: number; readonly lt?: number; readonly lte?: number }
    | { readonly contains: Scalar }
    | { readonly containsAny: readonly Scalar[] };

export interface ListFilter {
    readonly where?: { readonly [field: string]: FieldFilter };
    /** Records created by this user ID (resources with ownership). */
    readonly owner?: string;
}

export interface ListOptions extends ListFilter {
    /** Sort by a declared scalar field, `createdAt` or `updatedAt`. Default: `updatedAt`, newest first. */
    readonly order?: { readonly field: string; readonly direction?: 'asc' | 'desc' };
    /** 1..100, default 20. */
    readonly limit?: number;
    /** Cursor from a previous page, for the default order. */
    readonly after?: string;
    /** Records to skip, up to 10,000, for numbered pages. */
    readonly offset?: number;
}
