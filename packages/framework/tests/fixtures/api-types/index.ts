import { input } from '@cossackframework/core';
import { defineApi, type ApiInput, type ApiRawInput, type ApiOutput, type ApiMethods } from '@cossackframework/framework/api';
const endpoint = defineApi({
    input: { params: input.object({ id: input.string() }), query: input.object({ tags: input.array(input.string()), page: input.number({ coerce: true }) }),
        body: input.object({ count: input.number() }) }, queryArrays: ['tags'],
    output: input.object({ count: input.number(), at: input.date() }),
    authorize: ({ input }) => { const count: number = input.body.count; return count > 0; },
    handler: ({ input, signal, c }) => {
        const id: string = input.params.id; const tags: string[] = input.query.tags;
        const page: number = input.query.page; const owned: AbortSignal = signal;
        // @ts-expect-error parsed numbers are not strings
        const wrong: string = input.body.count;
        // @ts-expect-error only declared request locations exist
        input.headers;
        return { count: input.body.count + page, at: new Date() };
    },
});
const incoming: ApiRawInput<typeof endpoint> = { params: { id: 'a' }, query: { tags: ['x'], page: '2' }, body: { count: 1 } };
const parsed: ApiInput<typeof endpoint> = { params: { id: 'a' }, query: { tags: ['x'], page: 2 }, body: { count: 1 } };
const wire: ApiOutput<typeof endpoint> = { count: 1, at: '2026-01-01' };
// @ts-expect-error strict raw JSON number
const wrongBody: ApiRawInput<typeof endpoint> = { ...incoming, body: { count: '1' } };
// @ts-expect-error parsed coercion result is a number
const wrongParsed: ApiInput<typeof endpoint> = { ...parsed, query: { tags: [], page: '2' } };
// @ts-expect-error dates serialize as ISO strings
const wrongWire: ApiOutput<typeof endpoint> = { count: 1, at: new Date() };
// @ts-expect-error JSON schema requires the declared output
defineApi({ output: input.object({ count: input.number() }), handler: () => ({ count: '1' }) });
// @ts-expect-error one explicit generic cannot silently erase the inferred output contract
defineApi<{}>({ output: input.number(), handler: () => 'wrong' });
// @ts-expect-error native Response cannot bypass a JSON schema
defineApi({ output: input.string(), handler: () => new Response() });
// @ts-expect-error native mode requires Response
defineApi({ handler: () => ({ count: 1 }) });
// @ts-expect-error authorization must return a boolean
defineApi({ authorize: () => 'true', handler: () => new Response() });
// @ts-expect-error only array query keys can be listed
defineApi({ input: { query: input.object({ page: input.number() }) }, queryArrays: ['page'], handler: () => new Response() });
// @ts-expect-error unknown query array name
defineApi({ input: { query: input.object({ tags: input.array(input.string()) }) }, queryArrays: ['missing'], handler: () => new Response() });
// @ts-expect-error undeclared input locations reject
defineApi({ input: { headers: input.object({}) }, handler: () => new Response() });
const native = defineApi({ handler: () => new Response() });
const response: ApiOutput<typeof native> = new Response();
type Named = ApiMethods<{ POST: typeof endpoint; helper: string }>;
const named: keyof Named = 'POST';
// @ts-expect-error arbitrary exports are not HTTP methods
const wrongMethod: keyof Named = 'helper';
type Default = ApiMethods<{ default: typeof native; POST: typeof endpoint }>;
const all: keyof Default = '*';
// @ts-expect-error the router gives default precedence
const shadowed: keyof Default = 'POST';
type Component = ApiMethods<{ default: new () => {}; POST: typeof endpoint }>;
// @ts-expect-error a default component does not execute named native handlers
const ignoredNative: keyof Component = 'POST';
const unvalidated: ApiOutput<(c: unknown) => { secret: string }> = 42;
