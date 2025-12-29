// src/pages/api/hello/index.ts
import { Page, State, Cossack } from '@cossackframework/core';
import { HTTPException } from 'hono/http-exception';

@Page({
    transport: 'http'
})
export class Hello extends Cossack<CloudflareBindings> {
    @State()
    private message: string = '';

    async get() {
        this.message = 'This message is in the state, but will not be returned.';

        // Example of accessing typed env:
        // const stub = this.env.COSSACK_OBJECT.get(id);

        // Return a custom response object using the Hono context
        return this.c.json({
            success: true,
            payload: 'Hello from a custom API response!'
        }, 201, { 'X-Custom-Header': 'Cossack-Framework' });
    }

    async post() {
        const body = await this.c.req.json();
        return this.c.json({
            success: true,
            mirroredBody: body
        });
    }

    async put() {
        const validation = this.c.req.query('validation');
        if (!validation) {
            throw new HTTPException(400, { message: 'Validation query parameter is required' });
        }
        return this.c.json({ success: true, message: 'Validation passed!' });
    }
}
