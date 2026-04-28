import { Cossack, Page, ClientState } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Layout } from '@/components/Layout';

@Page({
    transport: 'http'
})
export default class TailwindDemo extends Cossack {
    @ClientState()
    counter: number = 0;

    render() {
        return component(Layout, { dir: 'ltr' }, html`
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

                <div class="bg-white shadow-md rounded-lg p-6 mb-6">
                    <h2 class="text-xl font-semibold text-gray-800 mb-3">Interactive Counter</h2>
                    <p class="text-gray-500 mb-4">Count: <span class="text-2xl font-bold text-indigo-600" data-testid="counter-value">${this.counter}</span></p>
                    <button
                        class="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded transition-colors"
                        @click="${() => { this.counter++; }}"
                        data-testid="increment-btn"
                    >
                        Increment
                    </button>
                </div>

                <div class="flex gap-3">
                    <span class="inline-block bg-red-100 text-red-800 text-xs font-medium px-2.5 py-1 rounded-full">Badge 1</span>
                    <span class="inline-block bg-yellow-100 text-yellow-800 text-xs font-medium px-2.5 py-1 rounded-full">Badge 2</span>
                    <span class="inline-block bg-purple-100 text-purple-800 text-xs font-medium px-2.5 py-1 rounded-full">Badge 3</span>
                </div>
            </div>
        `);
    }
}
