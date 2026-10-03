import { defineUrlState, url, type InferUrlState } from '@cossackframework/core/url-state';
import { Cossack, type NavigateOptions } from '@cossackframework/core';
const filters = defineUrlState({ search: url.string(), page: url.integer({ default: 1, min: 1 }),
    sort: url.enum(['name', 'price']), tags: url.array(url.string()), optional: url.optional(url.boolean()) });
type Filters = InferUrlState<typeof filters>;
const values: Filters = filters.read('/').values;
const search: string = values.search;
const optional: boolean | undefined = values.optional;
filters.url('/', { page: 2, sort: 'price', tags: ['one'] });
filters.url('/', { page: undefined, optional: undefined }, { defaults: 'include' });
class List extends Cossack { get filters() { return this.urlState(filters); } }
const page: number = new List().filters.page;
// @ts-expect-error the component reader retains its inferred declaration
const wrongComponentPage: string = new List().filters.page;
const navigation: NavigateOptions = { history: 'replace' };
// @ts-expect-error inferred parsed number
const invalidPage: string = values.page;
// @ts-expect-error immutable state record
values.page = 2;
// @ts-expect-error immutable arrays
values.tags.push('two');
// @ts-expect-error number fields do not accept raw string coercion
filters.url('/', { page: '2' });
// @ts-expect-error unknown declared field
filters.url('/', { missing: 1 });
const extra = { page: 2, missing: 1 };
// @ts-expect-error extra variable fields
filters.url('/', extra);
declare const union: { page: number } | { page: number; missing: number };
// @ts-expect-error union cannot hide an extra field
filters.url('/', union);
// @ts-expect-error literal enum values remain narrow
filters.url('/', { sort: 'other' });
// @ts-expect-error array items retain their declared type
filters.url('/', { tags: [1] });
// @ts-expect-error only string/number/boolean values have portable scalar codecs
url.custom({ default: new Date(), parse: () => new Date(), serialize: String });
// @ts-expect-error codecs are synchronous
url.custom({ default: 0, parse: async () => 1, serialize: String });
// @ts-expect-error array item codecs cannot be arrays
url.array(url.array(url.string()));
// @ts-expect-error optional items do not belong in a repeated query array
url.array(url.optional(url.string()));
// @ts-expect-error enum default belongs to its declared literals
url.enum(['name', 'price'], { default: 'other' });
// @ts-expect-error a contract uses codec declarations
defineUrlState({ page: 1 });
// @ts-expect-error history must be explicit push/replace
new List().navigate('/', { history: 'add' });
