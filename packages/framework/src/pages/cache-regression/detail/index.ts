import { Cossack, Page, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { readVersion } from '../store';

@Page({ transport: 'http' })
export class CacheRegressionDetail extends Cossack {
    @State()
    version = 0;

    async init() {
        this.version = readVersion();
    }

    render() {
        return html`
            <main>
                <h1>Cache regression detail</h1>
                <p data-cache-version>Version: ${this.version}</p>
                <a href="/cache-regression/edit">Edit version</a>
            </main>
        `;
    }
}
