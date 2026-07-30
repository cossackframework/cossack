import { Client, Cossack, Page, Server } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { Button } from '@cossackframework/ui';
import { incrementVersion } from '../store';

@Page({ transport: 'http' })
export class CacheRegressionEdit extends Cossack {
    @Server()
    async mutateVersion() {
        incrementVersion();
    }

    @Client()
    async saveAndReturn() {
        await this.mutateVersion();
        this.redirect('/cache-regression/detail');
    }

    render() {
        return html`
            <main>
                <h1>Edit cache regression version</h1>
                ${component(Button, {
                    type: 'button',
                    '@click': this.saveAndReturn,
                }, 'Save version')}
            </main>
        `;
    }
}
