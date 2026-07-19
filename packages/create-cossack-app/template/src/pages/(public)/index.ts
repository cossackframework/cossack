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
            <div class="mx-auto max-w-6xl px-4 py-20 sm:py-28 text-center">
                <div class="space-y-6">
                    <h1 class="text-4xl sm:text-6xl font-bold tracking-tight text-foreground">
                        ${__('Hello Cossack!')}
                    </h1>
                    <p class="mx-auto max-w-2xl text-lg sm:text-xl text-muted-foreground">
                        ${__('A modern full-stack TypeScript framework')}
                    </p>
                </div>

                <div class="mt-10 flex flex-wrap items-center justify-center gap-4">
                    <a href="https://cossack.dev/docs"
                       class="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity">
                        ${__('Read the docs')}
                    </a>
                    ${this.user
                        ? html`<a href="/dashboard"
                              class="inline-flex items-center justify-center rounded-md border border-border px-6 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors">
                              ${__('Go to dashboard')}
                          </a>`
                        : html`<a href="/auth/register"
                              class="inline-flex items-center justify-center rounded-md border border-border px-6 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors">
                              ${__('Get started')}
                          </a>`}
                </div>

                <div class="mt-16 inline-flex items-center gap-4 bg-card rounded-xl border border-border px-8 py-6">
                    <span class="text-sm font-medium text-muted-foreground uppercase tracking-wide">${__('Count')}</span>
                    <span class="text-3xl font-bold tabular-nums text-foreground min-w-[3ch] text-center">${this.count}</span>
                    <button
                        @click=${this.increment}
                        class="bg-primary hover:opacity-90 text-primary-foreground font-semibold px-4 py-2 rounded-md transition-opacity cursor-pointer"
                    >
                        ${__('Increment')}
                    </button>
                </div>
            </div>
        `;
    }
}
