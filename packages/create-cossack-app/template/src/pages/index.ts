import { Cossack, Page, State, Server } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page()
export default class IndexPage extends Cossack {
    @State() count = 0;

    @Server()
    increment() {
        this.count++;
    }

    render() {
        // __() is a global — no import needed. Without src/lang/*.json it
        // returns the key itself (the English text below), so the page works
        // out of the box. Run `cossack lang publish` to enable translations.
        return html`
            <div class="flex flex-col items-center justify-center min-h-[70vh] gap-8 px-4">
                <div class="text-center space-y-4">
                    <h1 class="text-5xl font-bold text-gray-900 tracking-tight">${__('Hello Cossack!')}</h1>
                    <p class="text-lg text-gray-500">${__('A modern full-stack TypeScript framework')}</p>
                </div>

                <div class="flex items-center gap-4 bg-white rounded-xl shadow-sm border border-gray-200 px-8 py-6">
                    <span class="text-sm font-medium text-gray-500 uppercase tracking-wide">${__('Count')}</span>
                    <span class="text-3xl font-bold tabular-nums text-gray-900 min-w-[3ch] text-center">${this.count}</span>
                </div>

                <button
                    @click=${this.increment}
                    class="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold px-8 py-3 rounded-lg shadow-sm transition-colors cursor-pointer"
                >
                    ${__('Increment')}
                </button>
            </div>
        `;
    }
}
