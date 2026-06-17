import { Cossack, Page, State } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Layout } from '@/components/Layout';

const items = [
    { id: 1, title: 'Mountain Sunset', color: '#f59e0b' },
    { id: 2, title: 'Ocean View', color: '#3b82f6' },
    { id: 3, title: 'Forest Trail', color: '#22c55e' },
    { id: 4, title: 'City Lights', color: '#8b5cf6' },
];

@Page()
export default class ViewTransitionsDetail extends Cossack {
    @State()
    itemId: number = 0;

    @State()
    title: string = '';

    @State()
    color: string = '#ccc';

    async init() {
        const id = Number(this.c.req.param('id'));
        const item = items.find(i => i.id === id);
        if (item) {
            this.itemId = item.id;
            this.title = item.title;
            this.color = item.color;
        }
    }

    render() {
        return component(Layout, { dir: 'ltr' }, html`
            <style>
                .vt-detail-header {
                    height: 200px;
                    border-radius: 12px;
                }
            </style>
            <div class="p-5">
                <a href="/view-transitions"
                   data-transition-types="nav-back"
                   class="inline-block mb-4 text-blue-600 hover:underline">
                    &larr; Back to list
                </a>
                <h1>${this.title}</h1>
                <div class="vt-detail-header mt-4"
                     style="background:${this.color}; view-transition-name: item-${this.itemId};">
                </div>
                <p class="mt-4 text-gray-700">This is the detail page for item #${this.itemId}. The colored header morphed from the card you clicked, thanks to <code>view-transition-name</code> matching between the list and detail pages.</p>
            </div>
        `);
    }
}
