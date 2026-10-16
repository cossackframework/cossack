import type { GlobalAttributes } from "../native-attributes";
import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export type ItemProps = GlobalAttributes<HTMLDivElement> & {
    /** Leading media slot (avatar, icon, image). */
    media?: unknown;
    /** Trailing content slot (badge, chevron, action). */
    trailing?: unknown;
    /** Render a bottom border separator. Default true. */
    divider?: boolean;
    /** Add a visual hover background. Native child controls own actions. */
    hoverable?: boolean;
    /** Compact vertical padding. */
    compact?: boolean;
}

/**
 * Cossack UI Item — generic list-row primitive with media/content/trailing slots.
 *
 * A flexible building block for lists, menus, and cards. Pass `media` (leading),
 * children (main content), and `trailing` (trailing) slots.
 *
 *   <${Item}
 *       media=${html\`<${Avatar} src="/me.png" alt="" size=${40} />\`}
 *       trailing=${html\`<${Badge}>New</${Badge}>\`}
 *   >
 *       <div><p class="font-medium">Tan Nguyen</p><p class="text-sm text-muted-foreground">Admin</p></div>
 *   </${Item}>
 */
@Component()
export class Item extends Cossack {
    declare props: ItemProps;

    render() {
        const {
            media,
            trailing,
            divider = true,
            hoverable = false,
            compact = false,
            ...rest
        } = this.props;

        if ([divider, hoverable, compact].some(value => typeof value !== 'boolean')) throw new Error('Item divider, hoverable and compact must be boolean.');
        return html`
            <div
                class=${classMap({
                    "cs-item": true,
                    "flex items-center gap-3 w-full": true,
                    "px-3": true,
                    "py-2.5": !compact,
                    "py-1.5": compact,
                    "border-b": divider,
                    "hover:bg-accent hover:text-accent-foreground transition-colors motion-reduce:transition-none": hoverable,
                })}
                ...=${rest}
            >
                ${media != null
                    ? html`<div class="cs-item__media shrink-0">${media}</div>`
                    : null}
                <div class="cs-item__content flex-1 min-w-0">
                    ${this.children}
                </div>
                ${trailing != null
                    ? html`<div class="cs-item__trailing shrink-0">${trailing}</div>`
                    : null}
            </div>
        `;
    }
}
