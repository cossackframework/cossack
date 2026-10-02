// Compile the authored source against the published entry, without Vite.
import { Client, Cossack, CossackService, Server, Service, rpc$, type RpcCall, type RpcYield } from '@cossackframework/core';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

class BasePage extends Cossack {
  @Server()
  async *inherited(limit: number): AsyncGenerator<{ step: number }, { total: number }, void> {
    yield { step: limit };
    return { total: limit };
  }
}

class ClientPage extends BasePage {
  @Server()
  sync(id: string) { return { id }; }

  @Server()
  async identity<T>(value: T) { return value; }

  @Server()
  async *inferred(limit: number) {
    yield { step: limit, nested: [{ label: 'progress' }] };
    return { total: limit };
  }

  @Server()
  field = async function* (id: string) {
    yield { id };
    return { saved: true };
  };

  @Server()
  async *noReturn() { yield 'progress'; }

  @Server()
  iterable(): AsyncIterable<string> { return this.noReturn(); }

  @Server()
  redirectResult() { return new Response(null, { status: 302, headers: { Location: '/' } }); }

  @Server()
  async *responseStream() { yield 'progress'; return new Response(); }

  @Client()
  async consumeResults() {
    const call = rpc$(this.inferred(3));
    const typed: RpcCall<{ total: number }, { step: number; nested: { label: string }[] }> = call;
    type Result = Assert<Equal<Awaited<typeof call>, { total: number }>>;
    type Yield = Assert<Equal<RpcYield<typeof call>, { step: number; nested: { label: string }[] }>>;
    for await (const value of typed) {
      const step: number = value.step;
      const label: string = value.nested[0].label;
      // @ts-expect-error A yielded step is a number.
      const incorrect: string = value.step;
      void [step, label, incorrect];
    }
    const result = await call;
    const total: number = result.total;
    // @ts-expect-error The terminal result does not contain yielded fields.
    result.step;
    // @ts-expect-error RpcCall uses async iteration, not native-generator next().
    call.next();
    // @ts-expect-error Authored method arguments are still checked.
    rpc$(this.inferred('three'));
    const inherited = rpc$(this.inherited(2));
    const field = rpc$(this.field('item'));
    const sync = rpc$(this.sync('item'));
    const generic = rpc$(this.identity({ id: 'item', count: 2 }));
    const noReturn = rpc$(this.noReturn());
    const unknownReturn = rpc$(this.iterable());
    type InheritedResult = Assert<Equal<Awaited<typeof inherited>, { total: number }>>;
    type FieldResult = Assert<Equal<Awaited<typeof field>, { saved: boolean }>>;
    type FieldYield = Assert<Equal<RpcYield<typeof field>, { id: string }>>;
    type SyncResult = Assert<Equal<Awaited<typeof sync>, { id: string }>>;
    type SyncYield = Assert<Equal<RpcYield<typeof sync>, never>>;
    type GenericResult = Assert<Equal<Awaited<typeof generic>, { id: string; count: number }>>;
    type NoReturnResult = Assert<Equal<Awaited<typeof noReturn>, void>>;
    type BroadIterableResult = Assert<Equal<Awaited<typeof unknownReturn>, unknown>>;
    const response = rpc$(this.redirectResult());
    type ResponseResult = Assert<Equal<Awaited<typeof response>, unknown>>;
    const responseStream = rpc$(this.responseStream());
    type StreamResponseResult = Assert<Equal<Awaited<typeof responseStream>, unknown>>;
    const existingResponseCall = rpc$(null! as RpcCall<Response, never>);
    type ExistingResponseResult = Assert<Equal<Awaited<typeof existingResponseCall>, unknown>>;
    const mixedResponseCall = rpc$(null! as RpcCall<Response | { saved: boolean }, never>);
    type MixedResponseResult = Assert<Equal<Awaited<typeof mixedResponseCall>, unknown>>;
    // @ts-expect-error The client does not receive a native Response instance.
    (await response).status;
    const viewedAgain: typeof typed = rpc$(typed);
    const recovered: Promise<{ total: number } | { error: string }> = call.catch(() => ({ error: 'failed' }));
    const finalized: Promise<{ total: number }> = call.finally(() => {});
    const cancelled: Promise<void> = call.cancel();
    void [total, inherited, field, sync, generic, noReturn, unknownReturn, response, viewedAgain, recovered, finalized, cancelled];
  }
}

@Service()
class ReportService extends CossackService {
  @Server()
  async *report(ids: string[]) {
    for (const id of ids) yield { id };
    return ids.length;
  }
}
async function consumeService(service: ReportService) {
  const call = rpc$(service.report(['one', 'two']));
  type Result = Assert<Equal<Awaited<typeof call>, number>>;
  for await (const value of call) {
    const id: string = value.id;
    // @ts-expect-error Service yields do not contain the terminal result.
    value.total;
    void id;
  }
  const count: number = await call;
  // @ts-expect-error Service arguments retain the authored signature.
  rpc$(service.report([2]));
  void count;
}
void [ClientPage, consumeService];
