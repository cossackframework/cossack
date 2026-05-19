import { Service, State, Server, Shared } from '@cossackframework/core';

@Service()
export class CounterService {
    @State() count = 0;

    @Server()
    increment() {
        this.count++;
    }

    @Server()
    decrement() {
        this.count--;
    }

    @Shared()
    formatCount(): string {
        return `Count: ${this.count}`;
    }
}
