import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component, ClientState } from "@cossackframework/core";

export interface TabsProps {
    /** The currently active tab value. */
    value?: string;
    /** Tab list items: [{ value, label, content }]. */
    items?: Array<{ value: string; label: unknown; content?: unknown }>;
    /** Allow arbitrary HTML attributes to spread onto the root. */
    [key: string]: any;
}

/**
 * Cossack UI Tabs — accessible tabbed interface.
 *
 * Uses ARIA tablist/tab/tabpanel semantics with `role` attributes. The active
 * panel is rendered conditionally (`render() => null` for inactive cleanly
 * unmounts, so child components are disposed). `aria-selected` and
 * `aria-controls` provide screen-reader navigation; Tab/Arrow keys are left to
 * the consumer to wire via `@On('keydown')` if needed (native tablist roving
 * tabindex is not automatic in HTML).
 *
 *   ${component(Tabs, {
 *       value: 'account',
 *       items: [
 *           { value: 'account', label: 'Account', content: html\`<p>…</p>\` },
 *           { value: 'password', label: 'Password', content: html\`<p>…</p>\` },
 *       ],
 *   })}
 */
@Component()
export class Tabs extends Cossack {
    declare props: TabsProps;

    @ClientState() active: string = "";

    render() {
        const { items = [], ...rest } = this.props;
        const current = this.active || this.props.value || items[0]?.value || "";

        const tablistClasses = classMap({
            "cs-tabs__list": true,
            "inline-flex items-center gap-1 rounded-md bg-muted p-1": true,
        });

        return html`
            <div class="cs-tabs w-full" ...=${rest}>
                <div class=${tablistClasses} role="tablist">
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
                                    "px-3 py-1.5 text-sm font-medium rounded-sm transition-colors": true,
                                    "bg-background text-foreground shadow-sm": current === item.value,
                                    "text-muted-foreground hover:text-foreground": current !== item.value,
                                })}
                                @click=${() => { this.active = item.value; }}
                            >
                                ${item.label}
                            </button>
                        `,
                    )}
                </div>
                ${items.map(
                    (item) =>
                        current === item.value
                            ? html`
                                  <div
                                      role="tabpanel"
                                      id=${`panel-${item.value}`}
                                      aria-labelledby=${`tab-${item.value}`}
                                      class="cs-tabs__panel mt-4 focus:outline-none"
                                      tabindex="0"
                                  >
                                      ${item.content ?? this.children}
                                  </div>
                              `
                            : null,
                )}
            </div>
        `;
    }
}
