# Cossack reports

## `server$` resource read only in an event handler returns `initial` and never loads in time

**Found in:** storm-matching, outreach page lead form (2026-10-13).

**What happened:** A page declared
`leadProperty = server$((id) => getLeadPropertyContext(id), { deps: () => [this.selectedAddressId], initial: null })`
and read `this.leadProperty` only inside a `@Client()` click handler, never in
`render()`. Changing `selectedAddressId` did not fetch the resource. The first
read in the handler started the fetch but returned `null` (the `initial`
value), so the handler saw no data. Tracing `/crpc` showed the resource RPC
was sent only after that first read.

**Expected:** Either the resource refetches when its `deps` change, whether or
not `render()` reads it, or the docs say clearly that `server$` loads lazily
and only resources that `render()` reads are kept fresh. An awaitable accessor
(e.g. `await this.load$('leadProperty')`) would let handlers read the value
safely.

**Workaround:** Read the data from a resource that `render()` already uses (we
added the owner names to the outreach property detail).

**Status:** Fixed. New `await this.load$('leadProperty')` resolves the
resource for its current `deps`. It starts or shares the load, follows `deps`
changes made while it waits, and rejects with the load error.
`docs/server-functions.md` now says that `server$` fields load lazily. Tests:
`packages/core/tests/server-resource-status.test.ts` (`load$`).

## Controlled `MultiSelect` drops a pick made before the parent re-renders

**Found in:** storm-matching, outreach filters (2026-10-13). Seen in `@cossackframework/ui` 0.8.3; the logic is unchanged in `packages/ui/src/components/MultiSelect.ts` (0.9.0).

**What happened:** With `value` + `onChange` (controlled), `add()` builds
`next = [...this.selected, value]` and `remove()` filters `this.selected`.
`selected` returns `props.value` whenever it is set, and that prop only
updates after the parent's asynchronous re-render (~50 ms on a fast machine,
more on a heavy page or a phone). A second pick or removal inside that window
starts from the stale list:

- pick "Metal", then quickly "Unknown" → `onChange(['Unknown'])`, Metal lost;
- pick "Tile", then quickly remove "Metal" → Tile lost again.

Reproduced by clicking two options back to back (`opt1.click(); opt2.click()`).

**Expected:** Consecutive edits accumulate. Options: in controlled mode, base
the next value on `this.draft` until a newer `props.value` arrives (clear
`draft` when the prop changes), or emit change events (`onAdd`/`onRemove`) so the
owner can apply them to its current state.

**Workaround (storm-matching):** `renderMultiFilter()` in
`src/pages/dashboard/outreach/index.ts` compares `onChange`'s list with the value
it rendered, and applies only the added/removed items to the page's current
selection.

**Also noted (0.8.3 only):** the dropdown stays open after a pick and, on
mobile, covers the form's submit button. 0.9.0's `add()` calls `close()`, so
upgrading fixes it.

**Status:** Fixed. In controlled mode, `MultiSelect` now builds the next edit
on the last list it sent to `onChange` until the parent re-renders it. After
that re-render, it uses `value` again, so a parent can still reject an edit.
`max` also counts edits that are not rendered yet. Tests:
`packages/ui/tests/multi-select-controlled.test.ts`.

## Soft delete: `DeleteDateColumn` only affects `orm.remove()`; `IsNull()` is untyped

**Found in:** storm-matching, bulk actions / soft delete (2026-10-22).

**What happened:** Adding `deleted_at` to five tables. The ORM exports
`DeleteDateColumn`, but only `orm.remove(entity)` honours it: `Model.find()`,
`findOne()`, `count()`, `exists()` and the static `Model.delete()` neither
skip soft-deleted rows nor offer a `withDeleted` option, and there is no
`restore()`. So the app had to filter `deleted_at IS NULL` by hand in every
query and write its own restore / permanent delete SQL.

Also `IsNull()` is declared as `() => FindOperator` (`FindOperator<unknown>`),
so `where: { deletedAt: IsNull() }` fails type-checking against a
`Date | string | null` column and needs a cast
(`IsNull() as FindOperator<Date | string | null>`).

**Expected:** With a `DeleteDateColumn`, reads exclude soft-deleted rows by
default, with `withDeleted: true` to include them; `Model.softDelete(where)`,
`Model.restore(where)` and `Model.delete(where, { force: true })` (or similar)
for the three operations. `IsNull()` typed as `<T>() => FindOperator<T | null>`
(or `FindOperator<any>`).

**Workaround:** Plain `@Column({ type: 'datetime', nullable: true })` plus raw
`sql` for the filters and the restore / destroy statements.
