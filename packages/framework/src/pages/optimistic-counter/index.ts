import { Cossack, Page, Server, State, ClientState, Optimistic, Computed, Client } from '@cossackframework/core';
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

    @ClientState()
    private optimisticCount: number = 0;

    public head() {
        return { title: 'Optimistic Counter' };
    }

    @Computed()
    get displayCount() {
        return (this.loading['increment'] > 0) ? this.optimisticCount : this.count;
    }

    @Computed()
    get doubleCount() {
        return this.displayCount * 2;
    }

    @Server()
    async increment() {
        // Simulate a slow network/DB write (500ms)
        await new Promise(resolve => setTimeout(resolve, 500));
        this.count++;
    }

    @Optimistic('increment')
    applyOptimisticIncrement() {
        // If this is the first pending action, we start our optimistic divergence from the current known server state.
        if (!this.loading['increment']) {
            this.optimisticCount = this.count;
        }
        this.optimisticCount++;
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
                    Count: ${this.displayCount} (+${this.doubleCount} doubled)
                </div>

                <div class="flex gap-2.5 items-center">
                    ${component(Button, { '@click': this.increment }, 'Increment (+1)')}
                    ${component(Button, { '@click': this.toggleDetails, class: 'bg-gray-600 border-gray-400' }, this.showDetails ? 'Hide Info' : 'Show Info')}
                </div>

                ${this.showDetails ? html`
                    <div class="mt-5 p-4 bg-gray-100 rounded-lg border border-gray-300">
                        <h3>Debug Information</h3>
                        <p>This box is toggled via <strong>@ClientState</strong>.</p>
                        <p>Changing this value <strong>does not</strong> sync with other users or round-trip to the server.</p>
                        <p>Server-side count: ${this.count}</p>
                        <p>Optimistic count: ${this.optimisticCount}</p>
                        <p>Loading count: ${this.loading['increment'] || 0}</p>
                    </div>
                ` : ''}
            </div>
        `;
    }
}
