import { Cossack, Page, Server, State, Client, Optimistic, input, HeadContext, HeadValue } from "@cossackframework/core";
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

    // Every request carries the page's state, and fast clicks overlap: a plain
    // `this.count++` on the server would start each click from the same count.
    // Each click sends the count it expects instead, and previews it at once.
    @Optimistic('save')
    preview(value: { count: number }) {
        this.count = value.count;
    }

    @Server({ input: input.object({ count: input.number() }) })
    save(value: { count: number }) {
        this.count = value.count;
    }

    @Client()
    increment() {
        void this.save({ count: this.count + 1 });
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
                ${component(ButtonGroup, { label: 'Counter actions' }, html`
                    ${component(Button, { variant: 'outline', '@click': this.decrement, 'aria-label': 'Decrement' }, '-')}
                    ${component(Button, { '@click': this.increment, 'aria-label': 'Increment' }, '+')}
                `)}
            </div>
        `;
    }
}

export default CounterHttp;
