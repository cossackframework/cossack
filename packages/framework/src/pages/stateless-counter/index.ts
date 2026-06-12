import { Cossack, Page, Server, State, HeadContext, HeadValue } from '@cossackframework/core';
import { html, type TemplateResult, component } from '@cossackframework/renderer';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/Button';

@Page({
    transport: 'durable-object',
})
export class StatelessCounter extends Cossack {
    @State()
    private count: number = 0;

    public head(context: HeadContext): HeadValue {
        return {
            title: 'Stateless Counter'
        };
    }

    @Server()
    async increment() {
        this.count++;
    }

    render(): TemplateResult {
        return component(Layout, {
            dir: 'ltr',
        }, html`
            <div>
                <h1>Stateless Counter</h1>
                <p>
                    This counter uses a <strong>stateless</strong> Durable Object.
                    State is ephemeral — it resets when the DO is evicted.
                </p>

                <div class="text-[2rem] my-5">
                    Count: ${this.count}
                </div>

                ${component(Button, { '@click': this.increment }, 'Increment (+1)')}
            </div>
        `);
    }
}
