import { html, classMap } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    ClientState,
    Client,
    ClientTask,
    createRef,
    type RefObject,
} from "@cossackframework/core";

export interface TabsProps {
    /** The currently active tab value. */
    value?: string;
    /** Tab list items: [{ value, label, icon?, content? }]. */
    items?: Array<{ value: string; label: unknown; icon?: unknown; content?: unknown }>;
    /** Layout direction. "horizontal" (default) or "vertical". */
    orientation?: "horizontal" | "vertical";
    /** Visual variant. "pill" (default, rounded bg) or "underline". */
    variant?: "pill" | "underline";
    [key: string]: any;
}

/**
 * Cossack UI Tabs — accessible tabbed interface with animated indicator.
 *
 * Features:
 *   - **Sliding indicator**: the active-tab highlight smoothly animates between
 *     tabs using JS-measured positions + CSS transition (no layout thrash).
 *   - **Vertical orientation**: `orientation: "vertical"` renders a vertical
 *     tab list on the left with panels on the right.
 *   - **Variants**: `"pill"` (rounded background, default) or `"underline"`
 *     (bottom-border indicator).
 *   - **Icons**: pass an `icon` (SVG template or `Icon` component) per tab item;
 *     rendered before the label.
 *   - ARIA tablist/tab/tabpanel semantics with roving tabindex.
 *   - Arrow-key navigation (Left/Right for horizontal, Up/Down for vertical).
 *   - Panel fade/slide animation on switch.
 *
 *   ${component(Tabs, {
 *       variant: 'underline',
 *       items: [
 *           { value: 'account', label: 'Account', icon: html\`<svg…/>\`, content: html\`<p>…</p>\` },
 *           { value: 'password', label: 'Password', icon: html\`<svg…/>\`, content: html\`<p>…</p>\` },
 *       ],
 *   })}
 *
 *   ${component(Tabs, {
 *       orientation: 'vertical',
 *       items: [...],
 *   })}
 */
@Component()
export class Tabs extends Cossack {
    declare props: TabsProps;

    @ClientState() active: string = "";
    @ClientState() private indicatorStyle: string = "";

    tablistRef: RefObject<HTMLDivElement> = createRef<HTMLDivElement>();

    render() {
        const { items = [], orientation = "horizontal", variant = "pill", ...rest } = this.props;
        const current = this.active || this.props.value || items[0]?.value || "";
        const isVertical = orientation === "vertical";

        const tablistClasses = classMap({
            "cs-tabs__list": true,
            "relative": true,
            // Horizontal: inline row. Vertical: column on the left.
            "inline-flex items-center gap-1 rounded-md bg-muted p-1": !isVertical,
            "inline-flex flex-col gap-0.5 rounded-md bg-muted p-1 self-start": isVertical,
        });

        const rootClasses = classMap({
            "cs-tabs": true,
            "w-full": true,
            "flex gap-4": isVertical,
        });

        return html`
            <div class=${rootClasses} ...=${rest}>
                <div
                    ref=${this.tablistRef}
                    class=${tablistClasses}
                    role="tablist"
                    aria-orientation=${orientation}
                    @keydown=${(e: KeyboardEvent) => this.handleKeydown(e, items)}
                >
                    ${items.map(
                        (item) => html`
                            <button
                                type="button"
                                role="tab"
                                id=${`tab-${item.value}`}
                                aria-selected=${current === item.value}
                                aria-controls=${`panel-${item.value}`}
                                tabindex=${current === item.value ? 0 : -1}
                                class=${classMap({
                                    "cs-tabs__trigger": true,
                                    "relative z-10 text-sm font-medium transition-colors": true,
                                    "inline-flex items-center gap-2": !!item.icon,
                                    "px-3 py-1.5 rounded-sm": !isVertical,
                                    "px-3 py-2 rounded-sm w-full text-left": isVertical,
                                    "text-foreground": current === item.value,
                                    "text-muted-foreground hover:text-foreground": current !== item.value,
                                    "border-b-2 border-primary": variant === "underline" && current === item.value,
                                    "border-b-2 border-transparent": variant === "underline" && current !== item.value,
                                })}
                                @click=${() => { this.selectTab(item.value); }}
                            >
                                ${item.icon ? html`<span class="cs-tabs__icon inline-flex items-center justify-center w-4 h-4 shrink-0">${item.icon}</span>` : null}
                                ${item.label}
                            </button>
                        `,
                    )}
                    <!-- Sliding active indicator -->
                    <span
                        class="cs-tabs__indicator absolute z-0 transition-all duration-300 ease-in-out"
                        style=${this.indicatorStyle}
                    ></span>
                </div>
                ${items.map(
                    (item) => html`
                        <div
                            role="tabpanel"
                            id=${`panel-${item.value}`}
                            aria-labelledby=${`tab-${item.value}`}
                            class=${classMap({
                                "cs-tabs__panel focus:outline-none": true,
                                "mt-4": !isVertical,
                                "flex-1": isVertical,
                            })}
                            tabindex=${current === item.value ? 0 : -1}
                            aria-hidden=${current !== item.value}
                            hidden=${current !== item.value}
                        >
                            ${item.content ?? this.children}
                        </div>
                    `,
                )}
            </div>
        `;
    }

    onMount() {
        this.updateIndicator();
    }

    @Client()
    private selectTab(value: string) {
        this.active = value;
        // Wait for DOM to reflect the new active class, then move indicator.
        requestAnimationFrame(() => this.updateIndicator());
    }

    /** Position the sliding indicator over the active tab. Runs on client only. */
    @ClientTask()
    @Client()
    private updateIndicator() {
        const list = this.tablistRef.value;
        if (!list) return;
        const current = this.active || this.props.value || this.props.items?.[0]?.value || "";
        const activeTab = list.querySelector<HTMLElement>(`#tab-${current}`);
        if (!activeTab) return;

        const isVertical = this.props.orientation === "vertical";
        const variant = this.props.variant || "pill";

        if (isVertical) {
            const top = activeTab.offsetTop;
            const h = activeTab.offsetHeight;
            this.indicatorStyle =
                `top:${top}px;height:${h}px;left:4px;right:4px;` +
                `background:var(--color-background, #fff);border-radius:0.25rem;box-shadow:0 1px 2px rgb(0 0 0 / 0.06);`;
        } else if (variant === "underline") {
            const left = activeTab.offsetLeft;
            const w = activeTab.offsetWidth;
            this.indicatorStyle =
                `left:${left}px;width:${w}px;bottom:0;height:2px;` +
                `background:var(--color-primary, #2563eb);border-radius:1px;`;
        } else {
            // pill
            const left = activeTab.offsetLeft;
            const w = activeTab.offsetWidth;
            this.indicatorStyle =
                `left:${left}px;width:${w}px;top:4px;bottom:4px;` +
                `background:var(--color-background, #fff);border-radius:0.25rem;box-shadow:0 1px 2px rgb(0 0 0 / 0.06);`;
        }
    }

    /** Arrow-key navigation: Left/Right for horizontal, Up/Down for vertical. */
    @Client()
    private handleKeydown(
        e: KeyboardEvent,
        items: Array<{ value: string }>,
    ) {
        const isVertical = this.props.orientation === "vertical";
        const current = this.active || this.props.value || items[0]?.value || "";
        const idx = items.findIndex((i) => i.value === current);
        if (idx === -1) return;

        const nextKey = isVertical ? "ArrowDown" : "ArrowRight";
        const prevKey = isVertical ? "ArrowUp" : "ArrowLeft";

        if (e.key === nextKey) {
            e.preventDefault();
            const next = items[(idx + 1) % items.length];
            this.selectTab(next.value);
            this.focusTab(next.value);
        } else if (e.key === prevKey) {
            e.preventDefault();
            const prev = items[(idx - 1 + items.length) % items.length];
            this.selectTab(prev.value);
            this.focusTab(prev.value);
        } else if (e.key === "Home") {
            e.preventDefault();
            this.selectTab(items[0].value);
            this.focusTab(items[0].value);
        } else if (e.key === "End") {
            e.preventDefault();
            const last = items[items.length - 1];
            this.selectTab(last.value);
            this.focusTab(last.value);
        }
    }

    @Client()
    private focusTab(value: string) {
        requestAnimationFrame(() => {
            const list = this.tablistRef.value;
            list?.querySelector<HTMLElement>(`#tab-${value}`)?.focus();
        });
    }
}
