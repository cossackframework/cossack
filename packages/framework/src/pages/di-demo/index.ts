import { Page, Cossack, Inject } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';
import { CounterService } from '../../services/CounterService';

@Page()
export default class DiDemo extends Cossack {
    @Inject(CounterService)
    private counterService!: CounterService;

    render(): TemplateResult {
        return html`
            <div style="padding: 20px; font-family: sans-serif;">
                <h1>Dependency Injection Demo</h1>
                <p>This page uses a layout-scoped CounterService injected with @Inject.</p>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <button
                        @click=${() => this.counterService.decrement()}
                        style="padding: 8px 16px; font-size: 16px; cursor: pointer;"
                    >
                        -
                    </button>
                    <span style="font-size: 24px; min-width: 100px; text-align: center;">
                        ${this.counterService.formatCount()}
                    </span>
                    <button
                        @click=${() => this.counterService.increment()}
                        style="padding: 8px 16px; font-size: 16px; cursor: pointer;"
                    >
                        +
                    </button>
                </div>
                <p><a href="/di-demo/other">Open another page in this layout</a></p>
            </div>
        `;
    }
}
