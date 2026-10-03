import { optimisticCapture, recordOptimisticOperation } from './optimistic-state';

type Equal<Left, Right, Yes, No> =
    (<T>() => T extends Left ? 1 : 2) extends (<T>() => T extends Right ? 1 : 2) ? Yes : No;
type WritableKeys<Host> = {
    [Key in keyof Host]-?: Equal<{ [Field in Key]: Host[Field] }, { -readonly [Field in Key]: Host[Field] }, Key, never>;
}[keyof Host] & string;
type NumericKeys<Host> = { [Key in WritableKeys<Host>]: Host[Key] extends number ? Key : never }[WritableKeys<Host>];
type ArrayKeys<Host> = { [Key in WritableKeys<Host>]: Host[Key] extends unknown[] ? Key : never }[WritableKeys<Host>];
type Item<Value> = Value extends (infer Entry)[] ? Entry : never;

/** Explicit operations that rebase without running application handlers again. */
export interface OptimisticEdits<Host extends object> {
    increment<Key extends NumericKeys<Host>>(field: Key, amount: number): void;
    append<Key extends ArrayKeys<Host>>(field: Key, value: Item<Host[Key]>): void;
    /** Remove the first structurally equal item, preserving duplicate order. */
    remove<Key extends ArrayKeys<Host>>(field: Key, value: Item<Host[Key]>): void;
}

/** Use only during this target's synchronous @Optimistic handler. */
export function optimistic<Host extends object>(target: Host): OptimisticEdits<Host> {
    const call = optimisticCapture(target);
    return Object.freeze({
        increment(field: string, amount: number) { recordOptimisticOperation(target, call, field, { kind: 'increment', amount }); },
        append(field: string, value: unknown) { recordOptimisticOperation(target, call, field, { kind: 'append', value }); },
        remove(field: string, value: unknown) { recordOptimisticOperation(target, call, field, { kind: 'remove', value }); },
    });
}
export { OptimisticEditError } from './optimistic-state';
