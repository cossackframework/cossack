import { Cossack, Task, ClientTask, ServerTask, type TaskContext, type TaskDependencyPath } from '@cossackframework/core';
class Parent extends Cossack { inherited = 1; }
class Search extends Parent {
    query = '';
    nullable: null = null;
    absent: undefined = undefined;
    result: string[] = [];
    form: { user: { name: string } | null; rows: { id: number }[] } = { user: null, rows: [] };
    readonly fixed = 1;
    get calculated() { return 1; }
    @Task<Search>({ track: ['query', 'form.user.name', 'form.rows.0.id', 'form.rows.length', 'inherited', 'nullable', 'absent'] as const })
    async search(_signal: AbortSignal, task: TaskContext<Search>) {
        task.commit({ result: ['valid'], query: 'next', inherited: 2, nullable: null, absent: undefined });
        // @ts-expect-error wrong result type
        task.commit({ result: [2] });
        // @ts-expect-error missing field
        task.commit({ missing: 1 });
        // @ts-expect-error readonly field
        task.commit({ fixed: 2 });
        // @ts-expect-error computed getter
        task.commit({ calculated: 2 });
        // @ts-expect-error method is not a field
        task.commit({ search: async () => {} });
        // @ts-expect-error only synchronous field patches
        task.commit(() => { this.result = []; });
        // @ts-expect-error promise is not a patch
        task.commit(Promise.resolve({ result: [] }));
        // @ts-expect-error immutable context
        task.signal = new AbortController().signal;
    }
    @ClientTask<Search>({ track: ['form.rows.0.id'] }) client() {}
    @ServerTask<Search>({ track: ['inherited'] }) server() {}
}
Task<Search>({ track: ['query'] });
// @ts-expect-error unknown dependency
Task<Search>({ track: ['typo'] });
// @ts-expect-error unknown nested field
ClientTask<Search>({ track: ['form.user.missing'] });
// @ts-expect-error unknown array item field
ServerTask<Search>({ track: ['form.rows.0.missing'] });
// @ts-expect-error function dependency
Task<Search>({ track: ['search'] });
// @ts-expect-error primitive methods are not tracked paths
Task<Search>({ track: ['query.toString'] });
const privateShape: readonly TaskDependencyPath<{ hidden: { query: string } }>[] = ['hidden.query'];
Task<{ hidden: { query: string } }>({ track: privateShape });
// Legacy untyped paths remain runtime validated.
Task({ track: ['anything.nested'] });
