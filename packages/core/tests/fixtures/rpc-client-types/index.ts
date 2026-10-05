// Compile the authored source against the published entry, without Vite.
import { Client, Cossack, CossackService, Server, Service, rpc$, type RpcCall, type RpcYield, type RpcSerialized } from '@cossackframework/core';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type OptionalHook = Assert<Equal<RpcSerialized<{ id: number; toJSON?: () => { formatted: string } }>, { id: number } | { formatted: string }>>;
type UnknownResult = Assert<Equal<RpcSerialized<unknown>, unknown>>;
type AnyResult = Assert<Equal<RpcSerialized<any>, any>>;
type UnsupportedSymbol = Assert<Equal<RpcSerialized<symbol>, never>>;
class SelfRecord { id = 1; toJSON() { return this; } }
type SelfHook = Assert<Equal<RpcSerialized<SelfRecord>, { id: number }>>;

class BasePage extends Cossack {
  @Server()
  async *inherited(limit: number): AsyncGenerator<{ step: number }, { total: number }, void> {
    yield { step: limit };
    return { total: limit };
  }
}

class RecordModel {
  id = 7;
  createdAt = new Date();
  save() { return Promise.resolve(this); }
}
class JsonRecord {
  secret = 'not transferred';
  toJSON() { return { when: new Date(), id: 1 }; }
}

class ClientPage extends BasePage {
  @Server() structured() { return { when: new Date(), list: [new Date(), undefined] as [Date, undefined], absent: undefined }; }
  @Server() model() { return new RecordModel(); }
  @Server() customJson() { return new JsonRecord(); }
  @Server() async *dates() { yield { when: new Date() }; return new Date(); }
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
    const structured = rpc$(this.structured());
    type StructuredResult = Assert<Equal<Awaited<typeof structured>, { when: string; list: [string, null] }>>;
    const model = rpc$(this.model());
    type ModelResult = Assert<Equal<Awaited<typeof model>, { id: number; createdAt: string }>>;
    const json = rpc$(this.customJson());
    type JsonResult = Assert<Equal<Awaited<typeof json>, { when: string; id: number }>>;
    const dates = rpc$(this.dates());
    type DateResult = Assert<Equal<Awaited<typeof dates>, string>>;
    type DateYield = Assert<Equal<RpcYield<typeof dates>, { when: string }>>;
    // @ts-expect-error JSON dates have no native Date methods.
    (await structured).when.getTime();
    // @ts-expect-error Model prototype methods do not cross the wire.
    (await model).save();
    // @ts-expect-error Custom JSON fields replace native fields.
    (await json).secret;
    const call = rpc$(this.inferred(3));
    const typed: RpcCall<{ total: number }, { step: number; nested: { label: string }[] }> = call;
    const perCall = rpc$(() => this.inferred(4), { timeout: 100, signal: new AbortController().signal });
    const typedPerCall: RpcCall<{ total: number }, { step: number; nested: { label: string }[] }> = perCall;
    // @ts-expect-error Per-call options require a factory so invalid settings are checked before dispatch.
    rpc$(this.inferred(4), { timeout: 100 });
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
    type ResponseResult = Assert<Equal<Awaited<typeof response>, Response | undefined>>;
    const responseStream = rpc$(this.responseStream());
    type StreamResponseResult = Assert<Equal<Awaited<typeof responseStream>, never>>;
    const existingResponseCall = rpc$(null! as RpcCall<Response, never>);
    type ExistingResponseResult = Assert<Equal<Awaited<typeof existingResponseCall>, Response | undefined>>;
    const mixedResponseCall = rpc$(null! as RpcCall<Response | { saved: boolean }, never>);
    type MixedResponseResult = Assert<Equal<Awaited<typeof mixedResponseCall>, Response | undefined | { saved: boolean }>>;
    // @ts-expect-error A redirect can complete without a Response.
    (await response).status;
    const viewedAgain: typeof typed = rpc$(typed);
    const recovered: Promise<{ total: number } | { error: string }> = call.catch(() => ({ error: 'failed' }));
    const finalized: Promise<{ total: number }> = call.finally(() => {});
    const cancelled: Promise<void> = call.cancel();
    void [total, perCall, typedPerCall, inherited, field, sync, generic, noReturn, unknownReturn, response, viewedAgain, recovered, finalized, cancelled];
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
