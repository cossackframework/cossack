---
title: "Typed URL state"
description: "Share query values between server rendering, browser hydration, and navigation."
---

# Typed URL state

Use `defineUrlState` to declare query values for search, filters, sorting and
pagination. Core owns the portable codecs. The same declaration parses a server
request and its browser destination.

```ts
import { defineUrlState, url, type InferUrlState } from '@cossackframework/core/url-state';

export const filters = defineUrlState({
    search: url.string(),
    page: url.integer({ default: 1, min: 1 }),
    sort: url.enum(['name', 'price']),
    tags: url.array(url.string()),
});

export type Filters = InferUrlState<typeof filters>;

filters.read('/list?search=books&page=2').values;
// { page: 2, search: 'books', sort: 'name', tags: [] }

filters.url('/list?utm=mail#rows', { search: '雪 & books', page: 2 });
// /list?utm=mail&page=2&search=%E9%9B%AA+%26+books#rows
```

The root core entry exports these helpers too. URL construction returns a path,
query and fragment for this application. It does not return an external origin.
It snapshots the declaration and defaults. Parsed records and arrays are immutable.

## Component and resource example

Read the declaration through `this.urlState()` in a getter. The component needs
a request context, which bootstrap supplies. Constructor-time reads fail with
guidance. Repeated reads of one declaration and URL reuse the same frozen values.

```ts
import { Cossack, Page, Client, server$, defineUrlState, url } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

const filters = defineUrlState({
    search: url.string(),
    page: url.integer({ default: 1, min: 1 }),
});

@Page({ transport: 'http' })
export default class List extends Cossack {
    get filters() { return this.urlState(filters); }

    label = server$(async (search: string, page: number) => `${search}:${page}`, {
        initial: '',
        deps: () => [this.filters.search, this.filters.page] as const,
    });

    @Client()
    next() {
        return this.updateUrlState(filters, { page: this.filters.page + 1 }, {
            history: 'push',
        });
    }

    render() {
        return html`<p>${this.label}</p><button @click=${this.next}>Next page</button>`;
    }
}
```

SSR metadata carries the public path and query. Browser bootstrap uses that
destination before history changes. Retained layouts receive the new destination
too. Matching query-derived resource arguments reuse SSR data during hydration.
`history: 'replace'` replaces the active history entry and preserves its other
application data. The default is `push`. Existing navigation outcomes and guards apply.

`updateUrlState(definition, patch, options)` returns the same navigation outcome.
It merges each patch with the latest pending query intent. A later patch wins
for a repeated key; patches from separate declarations retain unrelated keys.
Outgoing page reads and the address stay committed while a query fetch is pending.
Guards, failures, ordinary navigation and disposal release pending ownership.
For repeated relative increments, compute the intended number explicitly:
two calls that both read `this.filters.page + 1` request the same number.

Same-path navigation to the same page class preserves declared `ClientState`
and `ClientStore` drafts when user, transport, provider and service ownership
match. The framework adopts the latest local values when publishing the prepared page. SSR JSON and copied URLs
cannot restore them. Stores get proxies owned by the new page; declared File
values retain their identity. Browser file-input DOM values are not restored.
Unrelated pages and changed ownership start with new drafts. New page tasks,
transports, onMount and clientInit start at publication. Framework preparation
keeps the old page editable and does not bind retained services to the destination.
A custom bootstrap override runs during preparation; it must not assume that
local drafts have transferred or that its page has become visible.

Retained layouts keep their drafts and service instances. Their resource entries
are replaced with the new SSR results before changing query dependencies.
Matching arguments require no extra RPC; old pending results cannot publish
into the new entries. Discarding an old result does not terminate application I/O.
Query changes keep the current page editable while waiting, including when a
`loading.ts` component exists.

Browser back/forward activates its history entry before Cossack renders it.
These traversals supersede pending query patches. A later update starts from
the restored committed query, so abandoned fields cannot reappear. Back,
forward and replacement preserve matching declared drafts even while an older
query response remains pending. A blocked or failed traversal restores the
previous owned entry. Read the [guard contract](./prevent-navigation.md#guards-during-back-and-forward)
for confirmation and history ownership.

Navigation has a 30-second completion budget. The complete post-publication,
ownership-change and resource-read audit remains open in the
[implementation plan](../specs/release-0.9.0-plan.md#rt-08).

## Parsing and defaults

| Codec | Accepted query text | Missing default |
| --- | --- | --- |
| `url.string()` | A valid UTF-8 string, including empty text. | `''` |
| `url.number()` | A finite decimal number. Exponents are accepted. | `0` |
| `url.integer()` | A safe integer within its declared range. | `0` |
| `url.boolean()` | Exactly `true` or `false`. | `false` |
| `url.enum(['name', 'price'])` | One declared literal. | First literal. |
| `url.array(codec)` | Repeated scalar keys. | `[]` |
| `url.optional(codec)` | The wrapped codec's values. | `undefined` |

Configure `default` on each ordinary codec. Strings also accept `minLength` and
`maxLength`. Numbers accept `min` and `max`. Arrays accept `maxItems`.
Optional resource dependencies need a JSON-compatible fallback, such as
`this.filters.optional ?? false`. Resource arguments cannot contain undefined.
Pass query values explicitly to server actions or resource dependencies.
An RPC request URL identifies its transport endpoint, not the browser page.

Invalid values use the field's default. A repeated scalar uses the default,
even when both values agree. One invalid array item resets the entire array.
Malformed percent escapes or invalid UTF-8 produce an encoding issue. Parsing
does not change the address. Read diagnostics through `filters.read(url).issues`.
Each issue contains a field and stable code, without the raw value.

Array items use repeated keys, such as `tags=books&tags=tools`. A bare `tags`
represents an explicit empty array. `tags=` represents one empty string.
Mixing a bare marker with items is invalid. This distinction also supports
nonempty defaults. Use the contract's serializer to retain it.

## Updates and limits

`filters.url(current, patch)` accepts declared fields with their inferred types.
It rejects unknown fields, wrong values, sparse arrays and accessors. Undefined
resets a field to its default. It normalizes all declared keys and sorts them.
Unrelated query pairs retain their order and encoded text. The fragment survives.

Defaults are omitted. Use `{ defaults: 'include' }` as the third argument to emit
them. Omission compares array values in order. Updating one key preserves the
other parsed values. Invalid existing declared values normalize to defaults.

Limits are 64 KiB of encoded query text, 1,024 pairs, 128 declared fields,
2,048 UTF-16 units per string and 100 items per array. Exceeding a total query
limit throws `UrlStateError`. Exceeding a field limit uses its default and records
an issue. Invalid declarations or update values also throw `UrlStateError`.

`url.custom({ default, parse, serialize })` accepts synchronous scalar codecs.
Return undefined from `parse` for invalid input. Serialization must round-trip
to the same value. Unexpected callback failures have a fixed diagnostic.
Returned promises are unsupported and observed without awaiting them.
