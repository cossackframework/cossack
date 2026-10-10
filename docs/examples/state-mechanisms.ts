import { Cossack, Page, State, Store, ClientState, ClientStore, Computed, Client, Server, server$ } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

/** Copy this page to src/pages/state-example/index.ts in a Cossack app. */
@Page({ transport: 'http' })
export default class StateMechanisms extends Cossack<{}, { Resources: 'record' }> {
    @State() count = 1;
    @State() profile = { name: 'Ada' };
    @Store() cart = { lines: [{ quantity: 1, price: 3 }], tags: [] as string[] };
    @ClientState() selected = 1;
    @ClientState() panelOpen = false;
    @ClientStore() draft = { tags: ['first'] };

    @Computed()
    get total() { return this.cart.lines.reduce((sum, line) => sum + line.quantity * line.price, 0); }

    record = server$(async (id: number) => ({ id, label: `Record ${id}` }), {
        deps: () => [this.selected] as const,
        initial: { id: 0, label: 'Loading' },
    });

    @Client() replaceProfile() { this.profile = { ...this.profile, name: 'Grace' }; }
    // This deliberately demonstrates a shallow mutation. It does not request a render.
    @Client() mutateShallow() { this.profile.name = 'Unobserved'; }
    @Client() addLine() { this.cart.lines[0].quantity++; this.cart.tags.push('edited'); }
    @Client() editDraft() { this.draft.tags.push('next'); this.panelOpen = true; }
    @Client() nextRecord() { this.selected++; }
    @Server() saveCount() { this.count++; return this.count; }
    @Client() async submit() { await this.saveCount(); }

    render() {
        return html`<main>
          <h1>State mechanisms</h1>
          <span data-testid="state-count">${this.count}</span>
          <span data-testid="profile-name">${this.profile.name}</span>
          <span data-testid="cart-total">${this.total}</span>
          <span data-testid="cart-tags">${this.cart.tags.join(',')}</span>
          <span data-testid="draft-tags">${this.draft.tags.join(',')}</span>
          <span data-testid="panel-open">${String(this.panelOpen)}</span>
          <span data-testid="record-label">${this.record.label}</span>
          <button @click=${this.replaceProfile}>Replace profile</button>
          <button @click=${this.mutateShallow}>Mutate shallow state</button>
          <button @click=${this.addLine}>Edit nested cart</button>
          <button @click=${this.editDraft}>Edit local draft</button>
          <button @click=${this.nextRecord}>Next record</button>
          <button @click=${this.submit}>Save count</button>
        </main>`;
    }
}
