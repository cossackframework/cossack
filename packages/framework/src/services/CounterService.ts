import { CossackService, Service, State, Server, Shared } from '@cossackframework/core';

@Service()
export class CounterService extends CossackService {
    @State() count = 0;

    @Server()
    increment() {
        this.count++;
    }

    @Server()
    decrement() {
        this.count--;
    }

    @Server()
    goHome() {
        return this.redirect('/');
    }

    @Shared()
    formatCount(): string {
        return `Count: ${this.count}`;
    }
}
