import type { MiddlewareHandler } from 'hono';
import { Button, Input, Label, Typography } from '@cossackframework/ui';
import { html, type TemplateResult, component } from '@cossackframework/renderer';
import { Cossack, isServer, Page, Server, State, HeadTag, HeadContext, HeadValue } from '@cossackframework/core';

@Page({
    transport: 'http',
})
export class Contact extends Cossack {
    @State() // 'global' is always a valid channel.
    private greeting: string = 'Tan';

    public head(context: HeadContext): HeadValue {
        return {
            title: 'Contact'
        };
    }

    async init() {
        this.greeting = this.c.req.query('name') || 'Tan';
    }

    async post() {
        const body = await this.c.req.formData();
        this.greeting = body.get('name')?.toString() || 'Tan';

        return this.c.redirect('/contact?name=' + encodeURIComponent(this.greeting));
    }

    render(): TemplateResult {
        return html`
            ${component(Typography, { variant: 'h3' }, 'Contact page')}
            <p class="my-4">Hello ${this.greeting}</p>
            <form method="post" action="/contact" class="max-w-md space-y-3">
                ${component(Label, { for: 'name' }, 'Name')}
                ${component(Input, { type: 'text', id: 'name', name: 'name', value: this.greeting })}
                ${component(Button, { type: 'submit' }, 'Submit')}
            </form> 
        `;
    }
}
