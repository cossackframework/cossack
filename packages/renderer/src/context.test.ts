import { describe, it, expect } from 'vitest';
import { CossackElement, pushCurrentInstance, popCurrentInstance } from './cossack-element';
import { html, renderToString } from './cossack-html';
import { component } from './component';
import { createContext } from './context';

describe('Context API', () => {
    const ThemeContext = createContext('light');

    class ThemeConsumer extends CossackElement {
        render() {
            const theme = this.consume(ThemeContext);
            return html`<span>Theme: ${theme}</span>`;
        }
    }

    class ThemeProvider extends CossackElement {
        static properties = {
            theme: { state: true }
        };
        theme = 'light';

        render() {
            this.provide(ThemeContext, this.theme);
            return html`
                <div class="provider">
                    ${component(ThemeConsumer)}
                </div>
            `;
        }
    }

    it('provides and consumes context', async () => {
        const provider = new ThemeProvider();
        provider.theme = 'dark';
        
        pushCurrentInstance(provider);
        const output = renderToString(provider.render()!);
        popCurrentInstance();
        
        expect(output).toContain('Theme: dark');
    });

    it('uses default value if no provider', async () => {
        const consumer = new ThemeConsumer();
        pushCurrentInstance(consumer);
        const output = renderToString(consumer.render()!);
        popCurrentInstance();
        
        expect(output).toContain('Theme: light');
    });
});
