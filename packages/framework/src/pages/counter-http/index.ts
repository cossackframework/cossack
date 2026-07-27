import { Cossack, Page, Server, State, HeadContext, HeadValue } from "@cossackframework/core";
import { TemplateResult } from "@cossackframework/renderer";
import { component, html } from "@cossackframework/renderer";
import { Button, ButtonGroup } from "@cossackframework/ui";

@Page({
    transport: 'http'
})
export class CounterHttp extends Cossack {
    @State()
    count = 0;

    public head(context: HeadContext): HeadValue {
        return {
            title: 'Counter (HTTP)'
        }
    }

    async init() {
        this.count = 0;
    }

    @Server()
    increment() {
        this.count++;
    }

    @Server()
    decrement() {
        this.count--;
        this.redirect('/tasks'); // Example of redirecting after a server action
    }

    render(): TemplateResult | null {
        return html`
            <div>
                <h1>Counter (HTTP)</h1>
                <p>Count: ${this.count}</p>
                ${component(ButtonGroup, {}, html`
                    ${component(Button, { variant: 'outline', '@click': this.decrement, 'aria-label': 'Decrement' }, '-')}
                    ${component(Button, { '@click': this.increment, 'aria-label': 'Increment' }, '+')}
                `)}
            </div>
        `;
    }
}
