type TaskLeaf = Function | Date | RegExp | Map<unknown, unknown> | Set<unknown> |
    PromiseLike<unknown> | Blob | ArrayBuffer | AbortSignal | ReadableStream;

type IsTaskFunction<Value> = [NonNullable<Value>] extends [never] ? false :
    NonNullable<Value> extends Function ? true : false;

type StringTaskPath<Value, Depth extends unknown[] = []> =
    0 extends (1 & Value) ? string :
    Depth['length'] extends 6 ? never :
    Value extends TaskLeaf ? never :
    Value extends readonly (infer Item)[] ? 'length' | `${number}` | `${number}.${StringTaskPath<NonNullable<Item>, [...Depth, unknown]>}` :
    Value extends object ? {
        [Key in Extract<keyof Value, string>]-?: IsTaskFunction<Value[Key]> extends true ? never :
            Key | `${Key}.${StringTaskPath<NonNullable<Value[Key]>, [...Depth, unknown]>}`;
    }[Extract<keyof Value, string>] : never;

/** Public field paths, including nested objects and array indices (up to six segments). */
export type TaskDependencyPath<Host> = 0 extends (1 & Host) ? string | symbol :
    StringTaskPath<Host> | Extract<keyof Host, symbol>;

type Equal<Left, Right, Yes, No> =
    (<T>() => T extends Left ? 1 : 2) extends (<T>() => T extends Right ? 1 : 2) ? Yes : No;
type WritableTaskKeys<Values> = {
    [Key in keyof Values]-?: IsTaskFunction<Values[Key]> extends true ? never :
        Equal<{ [Field in Key]: Values[Field] }, { -readonly [Field in Key]: Values[Field] }, Key, never>;
}[keyof Values] & string;

/** Whole reactive-field replacements. Nested stores must retain their full field shape. */
export type TaskCommit<Values extends object> = Partial<Pick<Values, WritableTaskKeys<Values>>>;

/** One task execution's ownership. Keep this context when work cannot be canceled. */
export interface TaskContext<Values extends object = Record<string, unknown>> {
    readonly signal: AbortSignal;
    readonly task: string | symbol;
    readonly component: string;
    readonly trigger: string;
    readonly isCurrent: boolean;
    /** Apply reactive field values synchronously; return false for obsolete/disposed executions. */
    commit(values: TaskCommit<Values>): boolean;
}

/** An invalid commit contract, distinct from a failure in task setup or cleanup. */
export class TaskCommitError extends Error {
    constructor(detail: string) {
        super(`[Cossack] Invalid task commit: ${detail}`);
        this.name = 'TaskCommitError';
    }
}
