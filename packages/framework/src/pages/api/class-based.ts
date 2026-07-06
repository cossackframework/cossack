import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class ClassBasedApi extends Cossack {
    async get() {
        return this.c.json({ message: 'Hello from class!' });
    }

    async post() {
        const body = await this.c.req.json();
        return this.c.json({ message: 'Post received!', echo: body }, 201);
    }

    async put() {
        const validation = this.c.req.query('validation');
        if (!validation) {
            return this.c.json({ success: false, message: 'Validation query parameter is required' }, 400);
        }
        return this.c.json({ success: true, message: 'Validation passed!' });
    }

    async delete() {
        return this.c.json({ message: 'Delete request received!' });
    }
}
