import { CossackService, Server, Service, Shared, State } from '@cossackframework/core';

/** Declared on the layout; never resolve this through a global container. */
@Service()
export class ScopedCounterService extends CossackService {
  @State() count = 0;

  @Server()
  increment(): string {
    // HTTP RPC receives public service state from the client. This demonstration
    // counter must never be used for quotas, permissions, or durable records.
    this.count += 1;
    return 'Counter updated on the server.';
  }

  @Shared()
  formatCount(): string {
    return `Count: ${this.count}`;
  }
}
