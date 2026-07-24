import { Component, Cossack, Inject, Page } from '@cossackframework/core';
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { CounterService } from '../../../services/CounterService';
import { Button } from '@cossackframework/ui';

@Component()
class NestedCounterReadout extends Cossack {
    @Inject(CounterService)
    private counter!: CounterService;

    render(): TemplateResult {
        return html`<strong data-testid="nested-service-count">${this.counter.formatCount()}</strong>`;
    }
}

@Page()
export default class OtherDiPage extends Cossack {
    @Inject(CounterService)
    private counter!: CounterService;

    render(): TemplateResult {
        return html`
            <h1>Second DI Page</h1>
            <p data-testid="page-service-count">${this.counter.formatCount()}</p>
            ${component(NestedCounterReadout)}
            ${component(Button, { '@click': () => this.counter.goHome() }, 'Service redirect home')}
            <p><a href="/">Leave DI layout</a></p>
        `;
    }
}
