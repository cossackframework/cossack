import { Cossack, Page, ClientState, Client } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Button } from '@cossackframework/ui';

@Page()
export default class ViewTransitionsList extends Cossack {
    @ClientState()
    activeTab: string = 'overview';

    items = [
        { id: 1, title: 'Mountain Sunset', color: '#f59e0b' },
        { id: 2, title: 'Ocean View', color: '#3b82f6' },
        { id: 3, title: 'Forest Trail', color: '#22c55e' },
        { id: 4, title: 'City Lights', color: '#8b5cf6' },
    ];

    @Client()
    switchTab(name: string) {
        this.startViewTransition(() => {
            this.activeTab = name;
        }, ['tab-switch']);
    }

    render() {
        return html`
            <style>
                .vt-card {
                    display: block;
                    text-decoration: none;
                    color: inherit;
                }
                .vt-card-image {
                    height: 120px;
                    border-radius: 8px;
                    transition: transform 0.2s;
                }
                .vt-card:hover .vt-card-image {
                    transform: scale(1.03);
                }
                .vt-tab-content {
                    padding: 16px;
                    border-radius: 8px;
                    background: #f3f4f6;
                }
                .vt-tab-button {
                    padding: 8px 16px;
                    border: 2px solid #e5e7eb;
                    background: white;
                    cursor: pointer;
                    border-radius: 6px;
                    font-size: 14px;
                }
                .vt-tab-button.active {
                    border-color: #3b82f6;
                    color: #3b82f6;
                }
            </style>
            <div class="p-5">
                <h1>View Transitions Demo</h1>
                <p>This page demonstrates the browser View Transitions API for SPA navigations and same-route animations.</p>

                <h2 class="mt-5">Navigation Transitions (morph)</h2>
                <p>Click a card to navigate to the detail page with a slide transition. The card color morphs into the detail page header.</p>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
                    ${this.items.map(item => html`
                        <a href="/view-transitions/${item.id}"
                           data-transition-types="nav-forward"
                           class="vt-card">
                            <div class="vt-card-image"
                                 style="background:${item.color}; view-transition-name: item-${item.id};">
                            </div>
                            <p class="mt-1.5 font-medium">${item.title}</p>
                        </a>
                    `)}
                </div>

                <h2 class="mt-6">Same-Route Transitions (crossfade)</h2>
                <p>Click tabs to switch content with a crossfade. Uses <code>this.startViewTransition()</code>.</p>
                <div class="flex gap-2 mt-3">
                    ${['overview', 'details', 'reviews'].map(tab =>
                        component(Button, {
                            variant: this.activeTab === tab ? 'default' : 'outline',
                            class: `vt-tab-button ${this.activeTab === tab ? 'active' : ''}`,
                            '@click': () => this.switchTab(tab),
                        }, tab))}
                </div>
                <div class="vt-tab-content mt-3">
                    ${this.activeTab === 'overview' ? html`
                        <p><strong>Overview:</strong> A brief summary of the product goes here.</p>
                    ` : this.activeTab === 'details' ? html`
                        <p><strong>Details:</strong> Technical specifications and feature list.</p>
                    ` : html`
                        <p><strong>Reviews:</strong> User feedback and ratings.</p>
                    `}
                </div>
            </div>
        `;
    }
}
