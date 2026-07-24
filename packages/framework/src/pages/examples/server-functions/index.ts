import {
    Client,
    Cossack,
    HeadContext,
    HeadValue,
    Page,
    State,
    server$,
} from '@cossackframework/core';
import { html, type TemplateResult, component } from '@cossackframework/renderer';
import { Button, Label, NativeSelect } from '@cossackframework/ui';

type Region = 'asia' | 'europe' | 'americas';

interface RegionSummary {
    region: Region;
    message: string;
    resolvedAt: string;
}

@Page({ transport: 'http' })
export default class ServerFunctionsExample extends Cossack {
    @State()
    private region: Region = 'asia';

    serverInfo = server$(
        () => ({
            runtime: 'Cossack server loader',
            resolvedAt: new Date().toISOString(),
        }),
        { initial: { runtime: 'Loading…', resolvedAt: 'Loading…' } },
    );

    regionSummary = server$(
        async (region: Region): Promise<RegionSummary> => {
            await new Promise((resolve) => setTimeout(resolve, 450));
            return {
                region,
                message: `Read-only data for ${region}`,
                resolvedAt: new Date().toISOString(),
            };
        },
        {
            deps: () => [this.region] as const,
            initial: {
                region: 'asia',
                message: 'Loading the initial region…',
                resolvedAt: 'Loading…',
            },
        },
    );

    head(_context: HeadContext): HeadValue {
        return {
            title: 'server$ Example',
            description: 'Reactive, read-only server data without init(), @State(), or explicit @Server() methods.',
        };
    }

    @Client()
    private selectRegion(event: Event): void {
        this.region = (event.currentTarget as HTMLSelectElement).value as Region;
    }

    @Client()
    private async refreshRegion(): Promise<void> {
        await this.refresh$('regionSummary');
    }

    @Client()
    private invalidateRegion(): void {
        this.invalidate$('regionSummary');
    }

    render(): TemplateResult {
        return html`
            <section class="max-w-3xl space-y-6">
                <header>
                    <h1 class="text-3xl font-bold mb-2">Reactive server functions with <code>server$</code></h1>
                    <p class="text-gray-600">
                        Load read-only server data directly where it is rendered. Loader bodies are removed from
                        the client bundle and use Cossack's existing RPC and hydration pipeline.
                    </p>
                </header>

                <article class="rounded-lg border border-gray-300 p-4">
                    <h2 class="text-xl font-semibold mb-3">Named resource</h2>
                    <dl class="grid grid-cols-[8rem_1fr] gap-2 font-mono text-sm">
                        <dt class="text-gray-500">Runtime</dt><dd>${this.serverInfo.runtime}</dd>
                        <dt class="text-gray-500">Resolved</dt><dd>${this.serverInfo.resolvedAt}</dd>
                    </dl>
                </article>

                <article class="rounded-lg border border-gray-300 p-4 space-y-4">
                    <div>
                        <h2 class="text-xl font-semibold">Reactive dependencies</h2>
                        <p class="text-sm text-gray-600">
                            Changing the dependency fetches a new invocation and retains the previous value while pending.
                        </p>
                    </div>
                    <div class="space-y-2">
                        ${component(Label, { for: 'region' }, 'Region')}
                        ${component(NativeSelect, {
                            id: 'region', '.value': this.region, '@change': this.selectRegion,
                        }, html`
                            <option value="asia">Asia</option>
                            <option value="europe">Europe</option>
                            <option value="americas">Americas</option>
                        `)}
                    </div>
                    <div class="rounded bg-gray-50 p-3 font-mono text-sm">
                        <div>${this.regionSummary.message}</div>
                        <div class="text-gray-500">${this.regionSummary.resolvedAt}</div>
                    </div>
                    <div class="flex gap-2">
                        ${component(Button, { '@click': this.refreshRegion }, 'Refresh now')}
                        ${component(Button, { variant: 'outline', '@click': this.invalidateRegion }, 'Invalidate')}
                    </div>
                </article>

                <article class="rounded-lg border border-gray-300 p-4">
                    <h2 class="text-xl font-semibold mb-2">Inline resource</h2>
                    <p>
                        This request was rendered for
                        <strong>${server$(() => new URL(this.c.req.url).pathname)}</strong>.
                    </p>
                </article>

                <article class="rounded-lg border border-gray-300 p-4">
                    <h2 class="text-xl font-semibold mb-2">Config</h2>
                    <p>
                        Config values
                        <strong>${server$(() => config('app.name'))}</strong>.
                    </p>
                </article>

                <p class="text-sm text-gray-500">
                    Source: <code>src/pages/examples/server-functions/index.ts</code> ·
                    Guide: <a class="text-blue-600 underline" href="/docs/server-functions.md">server functions</a>
                </p>
            </section>
        `;
    }
}
