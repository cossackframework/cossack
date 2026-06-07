import { Cossack, Page, Server, State, ClientState, Optimistic, Client } from '@cossackframework/core';
import { html, type TemplateResult, component } from '@cossackframework/renderer';
import { Button } from '@/components/Button';

@Page({
    transport: 'durable-object',
})
export class OptimisticCounter extends Cossack {
    @State()
    private count: number = 0;

    @ClientState()
    private showDetails: boolean = false;

    public head() {
        return { title: 'Optimistic Counter' };
    }

    @Server()
    async increment() {
        // Simulate a slow network/DB write (500ms)
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.count++;
    }

    @Optimistic('increment')
    applyOptimisticIncrement() {
        this.count++;
    }

    @Client()
    toggleDetails = () => {
        this.showDetails = !this.showDetails;
    }

    render(): TemplateResult {
        return html`
            <div>
                <h1>Optimistic Counter</h1>
                <p>
                    This counter updates <strong>instantly</strong> on the client,
                    even though the server has a 500ms artificial delay.
                </p>

                <div class="text-[2rem] my-5">
                    Count: ${this.count}
                </div>

                <div class="flex gap-2.5 items-center">
                    ${component(Button, { '@click': this.increment }, 'Increment (+1)')}
                    ${component(Button, { '@click': this.toggleDetails, class: 'bg-gray-600 border-gray-400' }, this.showDetails ? 'Hide Info' : 'Show Info')}
                </div>

                ${this.showDetails ? html`
                    <div class="mt-5 p-4 bg-gray-100 rounded-lg border border-gray-300">
                        <h3>Debug Information</h3>
                        <p>This counter uses the <strong>auto-stable optimistic</strong> pattern.</p>
                        <p>The framework automatically detects which @State properties the optimistic handler modifies and buffers server updates until the chain completes.</p>
                        <p>Count: ${this.count}</p>
                        <p>Loading count: ${this.loading['increment'] || 0}</p>
                    </div>
                ` : ''}
            </div>
        `;
    }
}
