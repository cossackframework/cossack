/**
 * What the example plugin draws: a box on the dashboard's overview, its block on the site and
 * a stylesheet in the head of every site page. Imported on the server and in the browser, so
 * nothing here may reach the database.
 */
import { Component, Cossack } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import type { PluginHead } from '@cossackframework/cms';

/** A box on the dashboard's overview page. Overview components get no props. */
@Component()
export class ExampleWidget extends Cossack {
    render() {
        return html`<section class="rounded-lg border border-border bg-card p-4" data-testid="example-widget">
            <h2 class="text-sm font-semibold text-foreground">Example plugin</h2>
            <p class="mt-1 text-sm text-muted-foreground">A box from the plugin's <code>ui.ts</code>. Its screen keeps a reading list and counts posts.</p>
            <a href="/dashboard/example" class="mt-2 inline-block text-sm text-primary hover:underline">Open Example</a>
        </section>`;
    }
}

/** The example/callout block on the site, styled by assets/example.css. */
@Component()
export class ExampleCallout extends Cossack {
    declare props: { block: { data: { title?: string; text?: string; tone?: string } } };
    render() {
        const { title, text, tone } = this.props.block.data;
        return html`<aside class="example-callout" data-tone=${tone ?? 'info'}>
            ${title ? html`<p class="example-callout__title">${title}</p>` : null}
            <p class="example-callout__text">${text ?? ''}</p>
        </aside>`;
    }
}

/** Components for dashboard slots; links for the navigation and taskbars are in the manifest. */
export const slots = { 'dashboard.overview': [ExampleWidget] };

/** Renderers of the manifest's blocks, by the part of the name after the slash. */
export const blocks = { callout: ExampleCallout };

/** The callout's stylesheet, on every site page while the plugin is active. */
export const head: PluginHead = (_site, _helpers, plugin) => {
    const href = plugin.asset('assets/example.css');
    return href ? { links: [{ tag: 'link', attributes: { rel: 'stylesheet', href } }] } : {};
};
