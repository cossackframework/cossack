import { Cossack, Page, State, Server, Optimistic } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { Layout } from '@/components/Layout';

@Page({ transport: 'durable-object' })
export default class OptimisticCounter extends Cossack {
  @State() count = 0;

  @Server()
  async increment() {
    // Simulate a slow server response
    console.log('Server: incrementing (slowly)...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    this.count++;
    console.log('Server: incremented to', this.count);
  }

  @Optimistic('increment')
  applyOptimisticIncrement() {
    console.log('Client: Optimistic update!');
    this.count++;
  }

  template() {
    return Layout({ dir: 'ltr' }, html`
      <h1>Optimistic Counter</h1>
      <p>Current Count: <strong>${this.count}</strong></p>
      <p>
        <button @click=${() => this.increment()}>Increment (3s delay)</button>
      </p>
      <p>
        Notice how the count updates <em>instantly</em>, even though the server takes 3 seconds.
      </p>
      <hr>
      <p>
        <a href="/image-demo">Go to Image Demo (Client-Side Nav)</a>
      </p>
    `);
  }
}
