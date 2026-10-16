import { Client, ClientState, Component, Cossack, Page, Shared } from '@cossackframework/core';
import { component, html, isTemplateResult, type TemplateResult } from '@cossackframework/renderer';
import type { GlobalAttributes } from '@cossackframework/renderer/attributes';
import { Badge, Button } from '@cossackframework/ui';

type TileProps = GlobalAttributes<HTMLElement> & {
    heading: string;
    tone?: 'plain' | 'accent';
    count?: number;
    pinned?: boolean;
};

/** Renders its props, so each attribute form shows the prop it produced. */
@Component()
class Tile extends Cossack {
    declare props: TileProps;

    render(): TemplateResult {
        const { heading, tone = 'plain', count, pinned = false, ...rest } = this.props;
        return html`
            <article
                class="p-3 rounded-lg border ${tone === 'accent' ? 'border-violet-400 bg-violet-50' : 'border-gray-300 bg-white'}"
                data-tone=${tone}
                ?data-pinned=${pinned}
                ...=${rest}
            >
                <strong data-heading>${heading}</strong>
                <p class="text-sm text-gray-600">
                    tone: ${tone} · count: <span data-count>${count ?? 'none'}</span> · pinned: ${String(pinned)}
                </p>
            </article>
        `;
    }
}

const childrenKind = (children: unknown) =>
    children === undefined ? 'none' : isTemplateResult(children) ? 'template' : typeof children;

/** Shows the children it received and a named slot passed as a prop. */
@Component()
class Frame extends Cossack {
    declare props: GlobalAttributes<HTMLElement> & { label: string; footer?: TemplateResult };

    render(): TemplateResult {
        const { label, footer, ...rest } = this.props;
        return html`
            <figure class="p-3 rounded-lg border border-dashed border-gray-400" data-children-kind=${childrenKind(this.children)} ...=${rest}>
                <figcaption class="text-xs uppercase text-gray-500">${label} · children: ${childrenKind(this.children)}</figcaption>
                <div data-frame-content>${this.children}</div>
                ${footer ? html`<footer class="mt-2 text-sm text-gray-600" data-frame-footer>${footer}</footer>` : ''}
            </figure>
        `;
    }
}

/** Keeps its own client state and reports each change through a callback prop. */
@Component()
class StepCounter extends Cossack {
    declare props: { label: string; step?: number; onCount?: (count: number) => void };

    @ClientState()
    count = 0;

    @Client()
    increment() {
        this.count += this.props.step ?? 1;
        this.props.onCount?.(this.count);
    }

    render(): TemplateResult {
        return html`
            <div class="flex items-center gap-3" data-step-counter=${this.props.label}>
                <${Button} variant="outline" size="sm" @click=${this.increment}>+${this.props.step ?? 1}</${Button}>
                <span>${this.props.label}: <strong data-counter-value>${this.count}</strong></span>
            </div>
        `;
    }
}

@Component()
class InfoNote extends Cossack {
    declare props: { text: string };
    render(): TemplateResult {
        return html`<p class="p-3 rounded-lg bg-blue-50 text-blue-800" data-note="info">${this.props.text}</p>`;
    }
}

@Component()
class WarningNote extends Cossack {
    declare props: { text: string };
    render(): TemplateResult {
        return html`<p class="p-3 rounded-lg bg-amber-50 text-amber-800" data-note="warning">${this.props.text}</p>`;
    }
}

const NOTES = { info: InfoNote, warning: WarningNote };

/**
 * Component tags demo: child components written as `<${Class}>` tags.
 * Served at /renderer/component-tags.
 */
@Page({ transport: 'http' })
export default class ComponentTagsDemo extends Cossack {
    @ClientState()
    clicks = 0;

    @ClientState()
    reported = 0;

    @ClientState()
    note: keyof typeof NOTES = 'info';

    @Client()
    click() {
        this.clicks++;
    }

    @Client()
    toggleNote() {
        this.note = this.note === 'info' ? 'warning' : 'info';
    }

    @Shared()
    renderProps(): TemplateResult {
        const preset = { heading: 'From the spread', tone: 'accent', count: 7 } satisfies TileProps;
        return html`
            <div class="flex gap-3 my-3">
                <${Button} id="tags-click" variant="outline" size="sm" @click=${this.click}>Re-render the page</${Button}>
                <${Badge} variant="secondary">clicks: ${this.clicks}</${Badge}>
            </div>
            <div class="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
                <div>
                    <${Tile} id="tile-static" heading="Static text &amp; entities" />
                    <code class="block mt-1 text-xs">heading="Static text &amp;amp; entities"</code>
                </div>
                <div>
                    <${Tile} id="tile-live" heading="Clicked ${this.clicks} times" tone="accent" pinned count=${this.clicks} />
                    <code class="block mt-1 text-xs">heading="Clicked \${n} times" tone="accent" pinned count=\${n}</code>
                </div>
                <div>
                    <${Tile} id="tile-spread" ...=${preset} heading="Spread, then override" />
                    <code class="block mt-1 text-xs">...=\${preset} heading="Spread, then override"</code>
                </div>
            </div>
        `;
    }

    @Shared()
    renderChildren(): TemplateResult {
        return html`
            <div class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
                <${Frame} id="frame-none" label="Self-closing" />
                <${Frame} id="frame-text" label="Plain text">Just text</${Frame}>
                <${Frame} id="frame-value" label="One binding">${this.clicks}</${Frame}>
                <${Frame} id="frame-template" label="Markup" footer=${html`<small>Named slot through a prop</small>`}>
                    <p>Markup with <strong>${this.clicks}</strong> clicks</p>
                </${Frame}>
                <${Frame} id="frame-nested" label="Nested tags">
                    <${Badge} variant="success">inside</${Badge}>
                    <${Badge} variant="outline">a frame</${Badge}>
                </${Frame}>
            </div>
        `;
    }

    @Shared()
    renderState(): TemplateResult {
        return html`
            <div class="flex flex-col gap-3">
                <${StepCounter} label="By one" onCount=${(count: number) => { this.reported = count; }} />
                <${StepCounter} label="By five" step=${5} />
            </div>
            <p class="mt-3">
                Last count reported by the first counter: <strong id="reported-count">${this.reported}</strong>.
                Re-rendering the page keeps each counter's own state.
            </p>
        `;
    }

    @Shared()
    renderRuntimeClass(): TemplateResult {
        return html`
            <div class="flex gap-3 my-3">
                <${Button} id="note-toggle" variant="outline" size="sm" @click=${this.toggleNote}>Switch note class</${Button}>
            </div>
            ${component(NOTES[this.note], { text: `component(NOTES['${this.note}'], props) picks the class at render time.` })}
        `;
    }

    render(): TemplateResult {
        return html`
            <div class="p-5 m-5 border-2 border-dashed border-gray-300" data-component-tags-demo>
                <h1>Component tags</h1>
                <p>
                    Write a child component as a tag: <code>&lt;\${Card} padding="sm"&gt;…&lt;/\${Card}&gt;</code>.
                    Attributes become props and content becomes children. Run
                    <code>cossack check templates</code> to check props against each component's types.
                </p>
                <p><a href="/renderer/directives">Open the renderer directives demos →</a></p>

                <section class="mt-6" id="tag-props-demo">
                    <h2>Attributes become props</h2>
                    <p>Static text, interpolated text, bare booleans, values and spreads.</p>
                    ${this.renderProps()}
                </section>

                <section class="mt-6" id="tag-children-demo">
                    <h2>Content becomes children</h2>
                    <p>Nothing, text, a single value, a template, and nested tags. Named slots are props.</p>
                    ${this.renderChildren()}
                </section>

                <section class="mt-6" id="tag-state-demo">
                    <h2>Stateful children</h2>
                    <p>Each counter keeps its own client state and reports through a callback prop.</p>
                    ${this.renderState()}
                </section>

                <section class="mt-6" id="tag-runtime-demo">
                    <h2>Classes chosen at runtime</h2>
                    <p>Keep <code>component()</code> where the class comes from a registry.</p>
                    ${this.renderRuntimeClass()}
                </section>
            </div>
        `;
    }
}
