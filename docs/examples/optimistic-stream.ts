import {
    Cossack, Page, State, ClientState, Client, Server, Optimistic,
    optimistic, input, rpc$, RpcError, ClientVisibleError, server$, type RpcCall,
} from '@cossackframework/core';
import { html, bind } from '@cossackframework/renderer';
import { readCounter, incrementCounter } from '@/private/optimistic-stream.server';

/** Copy this page and its private store into an authenticated database app. */
@Page({ transport: 'sse' })
export default class OptimisticStream extends Cossack<{}, { Resources: 'counter' }> {
    @State() count = 0;
    @ClientState() pendingPreview = 0;
    @ClientState() draft = '';
    @ClientState() failAfterWrite = false;
    @ClientState() progress = 0;
    @ClientState() error = '';
    @ClientState() errorCode = '';
    @ClientState() recovery = '';
    private active?: RpcCall<number, { count: number }>;

    counter = server$(async () => readCounter(), { initial: { count: 0 } });

    async init() { this.count = (await readCounter()).count; }

    @Optimistic('increment')
    preview() {
        const edits = optimistic<OptimisticStream>(this);
        edits.increment('count', 1);
        edits.increment('pendingPreview', 1);
    }

    @Server({ input: input.object({ failAfterWrite: input.boolean() }), timeout: 10000 })
    async *increment(value: { failAfterWrite: boolean }) {
        this.count = (await incrementCounter()).count;
        yield { count: this.count };
        // The write has committed. This bounded demo pause makes Cancel observable.
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (value.failAfterWrite) throw new ClientVisibleError('The write committed before this stream failed.');
        return this.count;
    }

    @Client()
    async increase() {
        this.error = ''; this.errorCode = ''; this.recovery = ''; this.progress = 0;
        const call = rpc$(this.increment({ failAfterWrite: this.failAfterWrite }));
        this.active = call;
        try {
            for await (const _value of call) this.progress++;
            this.pendingPreview = 0;
            await this.refresh$('counter');
            this.count = this.counter.count;
        } catch (failure) {
            this.error = failure instanceof Error ? failure.message : 'The result is unknown.';
            this.errorCode = failure instanceof RpcError ? failure.code : '';
            const result = await this.reconcile$(failure, 'counter');
            this.recovery = result.state;
            if (result.state === 'recovered') this.count = this.counter.count;
            // This particular action deliberately fails after writing. That authored
            // error is outside transport uncertainty, so choose the read explicitly.
            if (result.state === 'not-needed' && this.errorCode === 'COSSACK_RPC_CLIENT_ERROR') {
                await this.refresh$('counter');
                this.count = this.counter.count;
                this.recovery = 'refreshed';
            }
        } finally {
            if (this.active === call) this.active = undefined;
        }
    }

    @Client() async cancel() { await this.active?.cancel(); }

    render() {
        const busy = (this.loading.increment ?? 0) > 0;
        return html`<main>
          <h1>Optimistic streamed counter</h1>
          <label>Local draft <input name="draft" .value=${bind(this, 'draft')} /></label>
          <label><input name="failAfterWrite" type="checkbox" .checked=${bind(this, 'failAfterWrite')} /> Fail after yield</label>
          <button @click=${this.increase} ?disabled=${busy}>Increase</button>
          <button @click=${this.cancel} ?disabled=${!busy}>Cancel</button>
          <p>Public count: <span id="optimistic-example-count">${this.count}</span></p>
          <p>Persisted read: <span id="optimistic-example-read">${this.counter.count}</span></p>
          <p>Loading: <span id="optimistic-example-loading">${this.loading.increment ?? 0}</span></p>
          <p>Local preview: <span id="optimistic-example-preview">${this.pendingPreview}</span></p>
          <p>Yields: <span id="optimistic-example-progress">${this.progress}</span></p>
          <p role="status" id="optimistic-example-recovery">${this.recovery}</p>
          <p role="alert" id="optimistic-example-error">${this.errorCode}</p>
          <p>${this.error}</p>
        </main>`;
    }
}
