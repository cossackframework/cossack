import { Cossack, Page, Server, State, ClientState, Optimistic } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';
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
        await new Promise(resolve => setTimeout(resolve, 500));
        this.count++;
    }

    @Optimistic('increment')
    applyOptimisticIncrement() {
        this.count++;
    }

    toggleDetails = () => {
        this.showDetails = !this.showDetails;
    }

    protected template(): TemplateResult {
        return html`
            <div>
                <h1>Optimistic Counter</h1>
                <p>
                    This counter updates <strong>instantly</strong> on the client, 
                    even though the server has a 500ms artificial delay.
                </p>
                
                <div style="font-size: 2rem; margin: 20px 0;">
                    Count: ${this.count}
                </div>

                <div style="display: flex; gap: 10px; align-items: center;">
                    ${Button({ '@click': this.increment }, 'Increment (+1)')}
                    ${Button({ '@click': this.toggleDetails }, this.showDetails ? 'Hide Info' : 'Show Info')}
                </div>

                ${this.showDetails ? html`
                    <div style="margin-top: 20px; padding: 15px; background: #f0f0f0; border-radius: 8px; border: 1px solid #ccc;">
                        <h3>Debug Information</h3>
                        <p>This box is toggled via <strong>@ClientState</strong>.</p>
                        <p>Changing this value <strong>does not</strong> sync with other users or round-trip to the server.</p>
                        <p>Server-side count: ${this.count}</p>
                    </div>
                ` : ''}
            </div>
        `;
    }
}
