import { Cossack, Page, ClientState } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Badge, Button, Card } from '@cossackframework/ui';

@Page({
    transport: 'http'
})
export default class TailwindDemo extends Cossack {
    @ClientState()
    counter: number = 0;

    render() {
        return html`
            <div class="max-w-2xl mx-auto p-6">
                <h1 class="text-3xl font-bold text-gray-900 mb-4">Tailwind CSS Demo</h1>
                <p class="text-gray-600 mb-6">This page uses Tailwind CSS 4.x utility classes for styling.</p>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                    <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <h2 class="text-lg font-semibold text-blue-800">Colors</h2>
                        <p class="text-blue-600 text-sm mt-1">Tailwind color utilities work as expected.</p>
                    </div>
                    <div class="bg-green-50 border border-green-200 rounded-lg p-4">
                        <h2 class="text-lg font-semibold text-green-800">Layout</h2>
                        <p class="text-green-600 text-sm mt-1">Grid and flex utilities for responsive design.</p>
                    </div>
                </div>

                ${component(Card, { class: 'mb-6' }, html`
                    <h2 class="text-xl font-semibold text-gray-800 mb-3">Interactive Counter</h2>
                    <p class="text-gray-500 mb-4">Count: <span class="text-2xl font-bold text-indigo-600" data-testid="counter-value">${this.counter}</span></p>
                    ${component(Button, {
                        '@click': () => { this.counter++; },
                        'data-testid': 'increment-btn',
                    }, 'Increment')}
                `)}

                <div class="flex gap-3">
                    ${component(Badge, { variant: 'destructive' }, 'Badge 1')}
                    ${component(Badge, { variant: 'warning' }, 'Badge 2')}
                    ${component(Badge, { variant: 'secondary' }, 'Badge 3')}
                </div>
            </div>
        `;
    }
}
