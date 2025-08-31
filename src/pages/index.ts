import type { MiddlewareHandler } from 'hono';
import { Button } from '@/components/Button';
import { Layout } from '@/components/Layout';
import { html, type TemplateResult } from '@cossackframework/renderer';
import { Cossack } from '@/shared/cossack';
import { isServer } from '@/shared/environment';
import { Client, Page, Server, State, Computed } from '@/shared/decorators';

// Example middleware
const loggingMiddleware: MiddlewareHandler = async (c, next) => {
    if (isServer) {
        console.log('Executing logging middleware...');
    }
    await next();
};

@Page({
    middlewares: [loggingMiddleware],
    channel: true,
})
export class Greeting extends Cossack {
    @State() private count: number = 0;
    @State() private name: string = 'World';

    @Server()
    async init() {
        // Simulate a data fetch
        await new Promise(resolve => setTimeout(resolve, 100));
        this.name = 'Cossack';
        this.count = 1;
    }

    @Computed()
    private get message(): string {
        return `Hello ${this.name} ${this.count}`;
    }

    @Server()
    private increment = async (user: any) => { // Actions now receive the user
         // Simulate a data fetch
        await new Promise(resolve => setTimeout(resolve, 100));
        
        this.count++;
        console.log(`Incrementing count on server by user ${user.id}...`, this.count);
    };

    @Server()
    private serverSideLog() {
        console.log('This message should only appear on the server.');
    }

    protected template(): TemplateResult {
        const isLoading = this.loading['increment'];
        return Layout({
            dir: 'ltr',
        }, html`
            <div>
                ${this.message}
                
                ${Button({
                    '@click': this.increment,
                    'disabled': isLoading || this.count >= 5 ? 'disabled' : undefined,
                    'type': 'button',
                }, html`${isLoading ? 'Incrementing...' : 'Increment'}`)}
            </div>
        `);
    }
}