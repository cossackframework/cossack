import { describe, it, expect } from 'vitest';
import { CossackElement } from './cossack-element';
import { html, renderToString } from './cossack-html';

describe('CossackElement Lifecycle in SSR', () => {
    class LifecycleElement extends CossackElement {
        static properties = {
            message: { state: true }
        };
        
        declare message: string;
        
        constructor() {
            super();
            this.message = 'Initial';
        }

        willUpdate(changedProperties: Map<string, unknown>) {
            if (changedProperties.has('message') || this.message === 'Initial') {
                this.message = 'Updated';
            }
        }

        render() {
            return html`<div>${this.message}</div>`;
        }
    }

    it('executes willUpdate before render', async () => {
        const el = new LifecycleElement();
        
        await el.requestUpdate();
        
        const template = el.render();
        expect(renderToString(template!)).toContain('Updated');
    });
});
