import { Cossack, Inject, Page } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';
import { CounterService } from '../../services/CounterService';

@Page({ services: [CounterService] })
export default class DiDemoLayout extends Cossack {
    @Inject(CounterService)
    private counter!: CounterService;

    render(): TemplateResult {
        return html`
            <aside data-testid="layout-service-count">${this.counter.formatCount()}</aside>
            ${this.children}
        `;
    }
}
