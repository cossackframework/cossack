import {
    Client,
    ClientState,
    Component,
    Cossack,
    Page,
    Shared,
} from '@cossackframework/core';
import {
    component,
    css,
    html,
    nothing,
    svg,
    unsafeCSS,
    type CSSResultGroup,
    type TemplateResult,
} from '@cossackframework/renderer';
import { Button } from '@cossackframework/ui';

const trustedAccent = unsafeCSS('#7c3aed');
const SVG_COLORS = ['#7c3aed', '#db2777', '#0891b2'] as const;
const sharedCardStyles = css`
    .scoped-card {
        border: 1px solid #d8b4fe;
        border-radius: ${14}px;
        background: #faf5ff;
        padding: 1rem;
    }
`;

class StyledCardBase extends Cossack {
    static styles: CSSResultGroup = [sharedCardStyles];
}

interface StyledCardProps {
    label: string;
    featured?: boolean;
    [key: string]: unknown;
}

@Component()
class StyledCard extends StyledCardBase {
    static styles: CSSResultGroup = [
        StyledCardBase.styles,
        css`
            .scoped-card[data-featured] {
                border-color: ${trustedAccent};
                animation: scoped-arrival 320ms ease-out;
            }

            :is(.scoped-card, .card-fallback) .scope-badge {
                display: inline-flex;
                margin-bottom: 0.5rem;
                border-radius: 999px;
                background: ${trustedAccent};
                color: white;
                padding: 0.15rem 0.55rem;
                font-size: 0.75rem;
                font-weight: 700;
            }

            @keyframes scoped-arrival {
                from { opacity: 0; transform: translateY(6px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `,
    ];

    declare props: StyledCardProps;

    render(): TemplateResult {
        return html`
            <article
                class="scoped-card"
                ?data-featured=${this.props.featured}
                data-demo-card=${this.props.label}
            >
                <span class="scope-badge">Scoped child</span>
                <strong>${this.props.label}</strong>
                <p>This card carries only the scope generated for <code>StyledCard</code>.</p>
            </article>
        `;
    }
}

@Component()
class IsolatedSibling extends Cossack {
    static styles = css`
        .scope-collision {
            border: 1px solid #fecaca;
            border-radius: 0.75rem;
            background: #fef2f2;
            color: #b91c1c;
            padding: 1rem;
        }
    `;

    render(): TemplateResult {
        return html`
            <article class="scope-collision" data-demo-sibling>
                <strong>Nested sibling scope</strong>
                <p>The page uses the same class name, but this component remains red.</p>
            </article>
        `;
    }
}

@Component()
class ProjectionHost extends Cossack {
    static styles = css`
        .projection-frame {
            border: 1px dashed #a78bfa;
            border-radius: 0.75rem;
            padding: 1rem;
        }

        .projected-copy {
            color: #dc2626;
        }
    `;

    render(): TemplateResult {
        return html`
            <article class="projection-frame" data-projection-host>
                <strong>Child-owned frame</strong>
                <div>${this.children}</div>
            </article>
        `;
    }
}

/**
 * Live integration demos for Lit-compatible renderer features.
 * Served at /renderer/lit-compat.
 */
@Page({ transport: 'http' })
export default class LitCompatibilityDemo extends Cossack {
    static styles = css`
        .renderer-demo {
            width: min(1120px, calc(100vw - 3rem));
            color: #1f2937;
        }

        .renderer-demo h1,
        .renderer-demo h2 {
            color: #111827;
        }

        .demo-lead {
            max-width: 70ch;
            color: #4b5563;
        }

        .demo-grid,
        .style-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1rem;
        }

        .demo-section {
            margin-top: 1.5rem;
            border: 1px solid #d1d5db;
            border-radius: 1rem;
            background: white;
            padding: 1.25rem;
            box-shadow: 0 8px 30px rgb(15 23 42 / 0.06);
        }

        .demo-panel {
            border-radius: 0.75rem;
            background: #f8fafc;
            padding: 1rem;
        }

        .demo-controls {
            display: flex;
            flex-wrap: wrap;
            gap: 0.65rem;
            margin: 1rem 0;
        }

        .demo-controls button,
        .event-button {
            border: 1px solid #9ca3af;
            border-radius: 0.6rem;
            background: white;
            padding: 0.5rem 0.8rem;
            cursor: pointer;
        }

        .demo-controls button:hover,
        .event-button:hover {
            border-color: ${trustedAccent};
        }

        .event-button[disabled] {
            cursor: not-allowed;
            opacity: 0.45;
        }

        .svg-stage {
            display: block;
            width: min(100%, 620px);
            min-height: 230px;
            border-radius: 1rem;
            background: linear-gradient(135deg, #ede9fe, #fdf4ff);
        }

        .svg-label {
            font: 700 15px system-ui, sans-serif;
            fill: #312e81;
        }

        .foreign-card {
            box-sizing: border-box;
            height: 100%;
            border: 1px solid #c4b5fd;
            border-radius: 0.6rem;
            background: rgb(255 255 255 / 0.9);
            padding: 0.65rem;
            font: 13px system-ui, sans-serif;
            color: #4c1d95;
        }

        .binding-list {
            display: grid;
            gap: 0.65rem;
            margin: 0;
            padding: 0;
            list-style: none;
        }

        .binding-list li {
            border-left: 3px solid #c4b5fd;
            padding-left: 0.75rem;
        }

        .scope-collision {
            border: 1px solid #bfdbfe;
            border-radius: 0.75rem;
            background: #eff6ff;
            color: #1d4ed8;
            padding: 1rem;
        }

        .projected-copy {
            color: #2563eb;
            font-weight: 700;
        }

        .implementation-note {
            border-radius: 0.75rem;
            background: #111827;
            color: #e5e7eb;
            padding: 0.8rem 1rem;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.85rem;
        }

        @media (max-width: 640px) {
            .renderer-demo { width: calc(100vw - 2rem); }
            .demo-section { padding: 1rem; }
        }
    `;

    @ClientState()
    svgColorIndex = 0;

    @ClientState()
    svgExpanded = false;

    @ClientState()
    showNothingValues = true;

    @ClientState()
    eventEnabled = true;

    @ClientState()
    eventCount = 0;

    @Client()
    cycleSvgColor() {
        this.svgColorIndex = (this.svgColorIndex + 1) % SVG_COLORS.length;
    }

    @Client()
    toggleSvgSize() {
        this.svgExpanded = !this.svgExpanded;
    }

    @Client()
    toggleNothingValues() {
        this.showNothingValues = !this.showNothingValues;
    }

    @Client()
    toggleEventBinding() {
        this.eventEnabled = !this.eventEnabled;
    }

    @Client()
    recordBoundEvent() {
        this.eventCount++;
    }

    @Shared()
    renderSvgDemo(): TemplateResult {
        const color = SVG_COLORS[this.svgColorIndex];
        const dots = [0, 1, 2].map((index) => svg`
            <circle
                cx=${55 + index * 54}
                cy=${this.svgExpanded ? 82 : 66}
                r=${14 + index * 3}
                fill=${color}
                opacity=${1 - index * 0.2}
            ></circle>
        `);

        return html`
            <div class="demo-controls">
                ${component(Button, {
                    id: 'svg-color-toggle',
                    variant: 'outline',
                    size: 'sm',
                    '@click': this.cycleSvgColor,
                }, 'Cycle color')}
                ${component(Button, {
                    id: 'svg-size-toggle',
                    variant: 'outline',
                    size: 'sm',
                    '@click': this.toggleSvgSize,
                }, this.svgExpanded ? 'Use compact geometry' : 'Expand geometry')}
            </div>
            <svg
                id="svg-demo-stage"
                class="svg-stage"
                viewBox=${this.svgExpanded ? '0 0 620 280' : '0 0 620 230'}
                role="img"
                aria-labelledby="svg-demo-title"
            >
                ${svg`
                    <title id="svg-demo-title">Namespaced Cossack SVG template</title>
                    <g data-svg-fragment>${dots}</g>
                    <path
                        d=${this.svgExpanded ? 'M40 130 C180 220 320 30 570 180' : 'M40 115 C190 175 350 45 570 135'}
                        fill="none"
                        stroke=${color}
                        stroke-width="5"
                        stroke-linecap="round"
                    ></path>
                    <text class="svg-label" x="40" y=${this.svgExpanded ? 245 : 200}>
                        svg\`...\` fragment + dynamic array
                    </text>
                    <foreignObject x="360" y="25" width="220" height="82">
                        ${html`
                            <div class="foreign-card" data-foreign-object-html>
                                <strong>HTML namespace</strong><br>
                                This card lives inside <code>&lt;foreignObject&gt;</code>.
                            </div>
                        `}
                    </foreignObject>
                `}
            </svg>
        `;
    }

    @Shared()
    renderNothingDemo(): TemplateResult {
        const shown = this.showNothingValues;
        const spreadValues = shown
            ? { title: 'Spread attributes are present', 'data-spread-state': 'present' }
            : nothing;

        return html`
            <div class="demo-controls">
                ${component(Button, {
                    id: 'nothing-toggle',
                    variant: 'outline',
                    size: 'sm',
                    '@click': this.toggleNothingValues,
                }, `Render ${shown ? 'nothing' : 'values'}`)}
                ${component(Button, {
                    id: 'event-toggle',
                    variant: 'outline',
                    size: 'sm',
                    '@click': this.toggleEventBinding,
                }, `${this.eventEnabled ? 'Disable' : 'Enable'} event binding`)}
            </div>

            <ul class="binding-list">
                <li>
                    <code>child</code>:
                    <span id="nothing-child">${shown ? 'managed child content' : nothing}</span>
                </li>
                <li>
                    <code>multi-expression attribute</code>:
                    <span
                        id="nothing-attribute"
                        data-demo-state="value-${shown ? 'present' : nothing}-suffix"
                    >inspect <code>data-demo-state</code></span>
                </li>
                <li>
                    <code>property</code>:
                    <input
                        id="nothing-property"
                        type="checkbox"
                        .checked=${shown ? true : nothing}
                        aria-label="Property binding demo"
                    >
                </li>
                <li>
                    <code>boolean attribute</code>:
                    <button
                        id="nothing-boolean"
                        class="event-button"
                        ?disabled=${shown ? true : nothing}
                    >disabled only while values render</button>
                </li>
                <li>
                    <code>event binding</code>:
                    <button
                        id="nothing-event"
                        class="event-button"
                        @click=${this.eventEnabled ? this.recordBoundEvent : nothing}
                    >Bound event count: <span id="event-count">${this.eventCount}</span></button>
                </li>
                <li>
                    <code>spread</code>:
                    <span id="nothing-spread" ...=${spreadValues}>inspect spread attributes</span>
                </li>
            </ul>
        `;
    }

    @Shared()
    renderStylesDemo(): TemplateResult {
        const projected = html`
            <p class="projected-copy" data-projected-copy>
                This projected template stays blue because the page created it.
            </p>
        `;

        return html`
            <p class="implementation-note">
                static styles = [sharedStyles, css\`...\`] · trusted raw token via unsafeCSS()
            </p>
            <div class="style-grid">
                ${component(StyledCard, { label: 'First instance', featured: true })}
                ${component(StyledCard, { label: 'Second instance' })}
                <article class="scope-collision" data-page-scope-sibling>
                    <strong>Page-owned sibling scope</strong>
                    <p>The same class name is blue in the page template.</p>
                </article>
                ${component(IsolatedSibling)}
                ${component(ProjectionHost, {}, projected)}
            </div>
        `;
    }

    render(): TemplateResult {
        return html`
            <div class="renderer-demo" data-renderer-lit-demo>
                <h1>More Lit-compatible rendering</h1>
                <p class="demo-lead">
                    Live framework examples for SVG template namespaces, the
                    <code>nothing</code> sentinel, and safe Light DOM component styles.
                    Every section is server-rendered, hydrated, and updated in place.
                </p>
                <p><a href="/renderer/directives">Open the renderer directives demos →</a></p>

                <section class="demo-section" id="svg-template-demo">
                    <h2><code>svg</code> templates</h2>
                    <p>Nested SVG fragments, arrays, dynamic geometry, and an HTML transition inside <code>foreignObject</code>.</p>
                    ${this.renderSvgDemo()}
                </section>

                <section class="demo-section" id="nothing-sentinel-demo">
                    <h2><code>nothing</code> in every binding context</h2>
                    <p>Toggle values to see child, attribute, property, boolean, event, and spread semantics update in place.</p>
                    ${this.renderNothingDemo()}
                </section>

                <section class="demo-section" id="scoped-styles-demo">
                    <h2>Safe component-scoped styles</h2>
                    <p>Style arrays, inheritance, safe interpolation, keyframes, sibling isolation, multiple instances, and projected ownership.</p>
                    ${this.renderStylesDemo()}
                </section>
            </div>
        `;
    }
}
