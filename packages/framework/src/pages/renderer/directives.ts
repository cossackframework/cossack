import { Cossack, Page, ClientState, Client } from '@cossackframework/core';
import {
    html,
    component,
    type TemplateResult,
    repeat,
    classMap,
    styleMap,
    when,
    choose,
    ifDefined,
    guard,
    cache,
    map,
    join,
    range,
    key,
} from '@cossackframework/renderer';
import { Button } from '@cossackframework/ui';

/**
 * Directives demo. One section per directive showing a visible/live example.
 * Served at /renderer/directives (file-based routing picks this up).
 */
@Page({
    transport: 'http',
})
export default class DirectivesDemo extends Cossack {
    // --- `when` / `choose` toggle -----------------------------------------
    @ClientState()
    whenOn: boolean = true;

    @ClientState()
    status: 'idle' | 'loading' | 'error' = 'idle';

    // --- `classMap` / `styleMap` ------------------------------------------
    @ClientState()
    active: boolean = true;

    @ClientState()
    hasErrors: boolean = false;

    // --- `ifDefined` ------------------------------------------------------
    @ClientState()
    href: string | undefined = 'https://cossack.dev';

    // --- `repeat` / `map` / `join` / `range` ------------------------------
    @ClientState()
    items: Array<{ id: number; text: string }> = [
        { id: 1, text: 'First' },
        { id: 2, text: 'Second' },
        { id: 3, text: 'Third' },
    ];

    // --- `key` remount counter --------------------------------------------
    @ClientState()
    keyCount: number = 0;

    // --- `cache` toggle (preserve state across template swaps) ------------
    @ClientState()
    showA: boolean = true;

    @ClientState()
    aCount: number = 0;

    @ClientState()
    bCount: number = 0;

    @Client()
    toggleWhen() {
        this.whenOn = !this.whenOn;
    }

    @Client()
    cycleStatus() {
        const order: Array<'idle' | 'loading' | 'error'> = ['idle', 'loading', 'error'];
        this.status = order[(order.indexOf(this.status) + 1) % order.length];
    }

    @Client()
    toggleActive() {
        this.active = !this.active;
    }

    @Client()
    toggleError() {
        this.hasErrors = !this.hasErrors;
    }

    @Client()
    toggleHref() {
        // Switch between a defined href and undefined to show `ifDefined`
        // dropping/restoring the attribute.
        this.href = this.href === undefined ? 'https://cossack.dev' : undefined;
    }

    @Client()
    addItem() {
        const nextId = (this.items.at(-1)?.id ?? 0) + 1;
        this.items = [...this.items, { id: nextId, text: `Item ${nextId}` }];
    }

    @Client()
    removeItem() {
        if (this.items.length > 0) {
            this.items = this.items.slice(0, -1);
        }
    }

    @Client()
    shuffleItems() {
        // Reverse to demonstrate keyed reordering with `repeat`.
        this.items = [...this.items].reverse();
    }

    @Client()
    bumpKey() {
        this.keyCount++;
    }

    @Client()
    toggleCache() {
        this.showA = !this.showA;
    }

    @Client()
    incA() {
        this.aCount++;
    }

    @Client()
    incB() {
        this.bCount++;
    }

    render(): TemplateResult {
        return html`
            <div class="p-5 m-5 border-2 border-dashed border-gray-300">
                <h1>Renderer Directives</h1>
                <p>
                    Live examples of every directive in
                    <code>@cossackframework/renderer</code>. Each card is interactive.
                </p>
                <p><a href="/renderer/lit-compat">Open the SVG, nothing, and scoped styles demos →</a></p>

                <div class="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-5 mt-5">
                    <!-- when -->
                    <section class="p-4 bg-blue-50 rounded-lg">
                        <h3><code>when</code></h3>
                        <p>Picks one of two templates based on a condition.</p>
                        <div class="mt-2">${when(
                            this.whenOn,
                            () => html`<p class="text-blue-800">✅ The switch is ON.</p>`,
                            () => html`<p class="text-gray-500">⭕ The switch is OFF.</p>`,
                        )}</div>
                        <div class="mt-2">
                            ${component(Button, {
                                variant: 'outline',
                                size: 'sm',
                                '@click': this.toggleWhen,
                            }, `Toggle (${this.whenOn ? 'on' : 'off'})`)}
                        </div>
                    </section>

                    <!-- choose -->
                    <section class="p-4 bg-purple-50 rounded-lg">
                        <h3><code>choose</code></h3>
                        <p>A switch over a value (status = <code>${this.status}</code>).</p>
                        <div class="mt-2">${choose(this.status, [
                            ['idle', () => html`<p class="text-gray-600">Idle — nothing happening.</p>`],
                            ['loading', () => html`<p class="text-purple-800">⏳ Loading…</p>`],
                            ['error', () => html`<p class="text-red-700">⛔ Something went wrong.</p>`],
                        ], () => html`<p>Unknown status</p>`)}</div>
                        <div class="mt-2">
                            ${component(Button, {
                                variant: 'outline',
                                size: 'sm',
                                '@click': this.cycleStatus,
                            }, 'Cycle status')}
                        </div>
                    </section>

                    <!-- classMap & styleMap -->
                    <section class="p-4 bg-emerald-50 rounded-lg">
                        <h3><code>classMap</code> &amp; <code>styleMap</code></h3>
                        <p>Dynamic classes and inline styles from objects.</p>
                        <div
                            class=${classMap({ 'p-2 mt-2 rounded': true, 'bg-emerald-200': this.active, 'bg-red-200': this.hasErrors })}
                            style=${styleMap({ fontWeight: this.active ? 'bold' : 'normal', opacity: this.hasErrors ? '0.6' : '1' })}
                        >
                            Watch me change style.
                        </div>
                        <div class="mt-2 flex gap-2">
                            ${component(Button, {
                                variant: 'outline',
                                size: 'sm',
                                '@click': this.toggleActive,
                            }, `active=${String(this.active)}`)}
                            ${component(Button, {
                                variant: 'outline',
                                size: 'sm',
                                '@click': this.toggleError,
                            }, `hasErrors=${String(this.hasErrors)}`)}
                        </div>
                    </section>

                    <!-- ifDefined -->
                    <section class="p-4 bg-amber-50 rounded-lg">
                        <h3><code>ifDefined</code></h3>
                        <p>Omits the attribute only when the value is <code>undefined</code>.</p>
                        <p class="mt-2">
                            href is: <code>${this.href === undefined ? 'undefined' : `"${this.href}"`}</code>
                        </p>
                        <a href="${ifDefined(this.href)}" class="text-blue-700 underline">
                            ${this.href ?? 'link (no href)'}
                        </a>
                        <div class="mt-2">
                            ${component(Button, {
                                variant: 'outline',
                                size: 'sm',
                                '@click': this.toggleHref,
                            }, 'Toggle href')}
                        </div>
                    </section>

                    <!-- repeat -->
                    <section class="p-4 bg-indigo-50 rounded-lg">
                        <h3><code>repeat</code> (keyed list)</h3>
                        <p>Keyed items keep their identity across reorders.</p>
                        <ul class="list-disc list-inside mt-2">
                            ${repeat(
                                this.items,
                                (item) => item.id,
                                (item) => html`<li>#${item.id}: ${item.text}</li>`,
                            )}
                        </ul>
                        <div class="mt-2 flex gap-2 flex-wrap">
                            ${component(Button, {
                                variant: 'outline',
                                size: 'sm',
                                '@click': this.addItem,
                            }, 'Add')}
                            ${component(Button, {
                                variant: 'outline',
                                size: 'sm',
                                '@click': this.removeItem,
                            }, 'Remove')}
                            ${component(Button, {
                                variant: 'outline',
                                size: 'sm',
                                '@click': this.shuffleItems,
                            }, 'Reverse')}
                        </div>
                    </section>

                    <!-- map & join -->
                    <section class="p-4 bg-teal-50 rounded-lg">
                        <h3><code>map</code> &amp; <code>join</code></h3>
                        <p><code>map</code> renders an iterable; <code>join</code> interleaves a separator.</p>
                        <p class="mt-2"><strong>map:</strong></p>
                        <ul class="list-disc list-inside">
                            ${map(this.items, (item) => html`<li>${item.text}</li>`)}
                        </ul>
                        <p class="mt-2"><strong>join (comma-separated):</strong></p>
                        <p>${join(this.items, (item) => item.text, ', ')}</p>
                    </section>

                    <!-- range -->
                    <section class="p-4 bg-pink-50 rounded-lg">
                        <h3><code>range</code></h3>
                        <p>A number sequence as an array (0..9).</p>
                        <div class="flex flex-wrap gap-1 mt-2">
                            ${range(0, 10).map((n) => html`<span class="px-2 py-1 bg-white rounded border border-gray-300">${n}</span>`)}
                        </div>
                    </section>

                    <!-- key -->
                    <section class="p-4 bg-orange-50 rounded-lg">
                        <h3><code>key</code></h3>
                        <p>Forces the subtree to remount when the key changes (counter = ${this.keyCount}).</p>
                        <div class="mt-2">
                            ${key(this.keyCount, html`<span class="inline-block px-3 py-1 bg-orange-200 rounded animate-fade-in">mounted @ ${this.keyCount}</span>`)}
                        </div>
                        <div class="mt-2">
                            ${component(Button, {
                                variant: 'outline',
                                size: 'sm',
                                '@click': this.bumpKey,
                            }, 'Remount child')}
                        </div>
                    </section>

                    <!-- guard -->
                    <section class="p-4 bg-lime-50 rounded-lg">
                        <h3><code>guard</code></h3>
                        <p>
                            Only re-renders when its deps change. The list below is wrapped in
                            <code>guard(this.items, …)</code> — it rebuilds only when the items
                            reference changes (e.g. Add/Remove/Reverse), not on unrelated re-renders.
                        </p>
                        <ul class="list-disc list-inside mt-2">
                            ${guard(this.items, () =>
                                this.items.map((item) => html`<li>${item.text}</li>`),
                            )}
                        </ul>
                    </section>

                    <!-- cache -->
                    <section class="p-4 bg-rose-50 rounded-lg">
                        <h3><code>cache</code></h3>
                        <p>
                            Keeps each branch's state alive across template swaps. Increment a
                            counter, switch away and back — the count is preserved.
                        </p>
                        <div class="mt-2 p-2 bg-white rounded border border-gray-300">
                            ${cache(
                                this.showA
                                    ? html`<div>
                                        <p class="text-rose-700">Branch A (count: ${this.aCount})</p>
                                        <div class="mt-1">
                                            ${component(Button, {
                                                variant: 'outline',
                                                size: 'sm',
                                                '@click': this.incA,
                                            }, 'increment A')}
                                        </div>
                                      </div>`
                                    : html`<div>
                                        <p class="text-indigo-700">Branch B (count: ${this.bCount})</p>
                                        <div class="mt-1">
                                            ${component(Button, {
                                                variant: 'outline',
                                                size: 'sm',
                                                '@click': this.incB,
                                            }, 'increment B')}
                                        </div>
                                      </div>`,
                            )}
                        </div>
                        <div class="mt-2">
                            ${component(Button, {
                                variant: 'outline',
                                size: 'sm',
                                '@click': this.toggleCache,
                            }, `Switch to branch ${this.showA ? 'B' : 'A'}`)}
                        </div>
                    </section>
                </div>
            </div>
        `;
    }
}
