import { Cossack, ClientState, ClientStore, Optimistic, Server, input, optimistic, type OptimisticEdits } from '@cossackframework/core';

// Complete public-export example; the server only acknowledges a validated edit.
export class Editor extends Cossack {
    @ClientState() accepted = 0;
    @ClientStore() items: { id: number; label: string }[] = [];
    @Optimistic('save') preview(value: { id: number; label: string }) {
        const edits = optimistic<Editor>(this);
        edits.increment('accepted', 1);
        edits.append('items', value);
    }
    @Server({ input: input.object({ id: input.number({ min: 0 }), label: input.string() }) })
    save(value: { id: number; label: string }) { return value.id; }
}

declare const edits: OptimisticEdits<{
    count: number; readonly frozen: number; maybe: number | null; title: string;
    list: { id: number }[]; readonly frozenList: string[]; immutableItems: readonly string[];
    calculate(): number;
}>;
edits.increment('count', 1);
edits.append('list', { id: 1 }); edits.remove('list', { id: 1 });
// @ts-expect-error Unknown field.
edits.increment('missing', 1);
// @ts-expect-error Strings are not counters.
edits.increment('title', 1);
// @ts-expect-error Nullable fields need an initialized numeric contract.
edits.increment('maybe', 1);
// @ts-expect-error Readonly properties cannot be replaced.
edits.increment('frozen', 1);
// @ts-expect-error Methods are not numeric fields.
edits.increment('calculate', 1);
// @ts-expect-error Array item shape must match.
edits.append('list', { name: 'wrong' });
// @ts-expect-error Removal also checks item shape.
edits.remove('list', 'wrong');
// @ts-expect-error Readonly fields cannot be replaced.
edits.append('frozenList', 'wrong');
// @ts-expect-error Readonly arrays cannot be edited.
edits.append('immutableItems', 'wrong');
// @ts-expect-error Scalar fields are not arrays.
edits.append('count', 1);
// @ts-expect-error Increment amount is numeric.
edits.increment('count', '1');
