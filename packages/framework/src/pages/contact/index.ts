import type { MiddlewareHandler } from 'hono';
import { Button } from '@/components/Button';
import { Layout } from '@/components/Layout';
import { html, type TemplateResult } from '@cossackframework/renderer';
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

    async get() {
        this.greeting = this.c.req.query('name') || 'Tan';
    }

    async post() {
        const body = await this.c.req.formData();
        this.greeting = body.get('name')?.toString() || 'Tan';

        return this.c.redirect('/contact?name=' + encodeURIComponent(this.greeting));
    }

    render(): TemplateResult {
        return html`
            <h1>Contact Page</h1>
            <div>Hello ${this.greeting}</div>
            <form method="post" action="/contact">
                <label for="name">Name:</label>
                <input type="text" id="name" name="name" value="${this.greeting}" />
                ${Button({ type: 'submit' }, 'Submit')}
            </form> 
        `;
    }
}