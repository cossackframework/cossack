import { Page, Cossack, Inject } from '@cossackframework/core';
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { CounterService } from '../../services/CounterService';
import { Button, Card, Typography } from '@cossackframework/ui';

@Page()
export default class DiDemo extends Cossack {
    @Inject(CounterService)
    private counterService!: CounterService;

    render(): TemplateResult {
        return html`
            ${component(Card, {}, html`
                ${component(Typography, { variant: 'h1' }, 'Dependency Injection Demo')}
                <p>This page uses a layout-scoped CounterService injected with @Inject.</p>
                <div class="my-5 flex items-center gap-3">
                    ${component(Button, {
                        variant: 'outline',
                        '@click': () => this.counterService.decrement(),
                        'aria-label': 'Decrement service count',
                    }, '-')}
                    <span class="min-w-24 text-center text-2xl">
                        ${this.counterService.formatCount()}
                    </span>
                    ${component(Button, {
                        '@click': () => this.counterService.increment(),
                        'aria-label': 'Increment service count',
                    }, '+')}
                </div>
                <p><a href="/di-demo/other">Open another page in this layout</a></p>
            `)}
        `;
    }
}
