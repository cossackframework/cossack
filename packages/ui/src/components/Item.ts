import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface ItemProps {
    /** Leading media slot (avatar, icon, image). */
    media?: unknown;
    /** Trailing content slot (badge, chevron, action). */
    trailing?: unknown;
    /** Render a bottom border separator. Default true. */
    divider?: boolean;
    /** Make the item clickable (adds hover bg + cursor). */
    interactive?: boolean;
    /** Compact vertical padding. */
    compact?: boolean;
    [key: string]: any;
}

/**
 * Cossack UI Item — generic list-row primitive with media/content/trailing slots.
 *
 * A flexible building block for lists, menus, and cards. Pass `media` (leading),
 * children (main content), and `trailing` (trailing) slots.
 *
 *   ${component(Item, {
 *       media: component(Avatar, { src: '/me.png', size: 40 }),
 *       trailing: component(Badge, {}, 'New'),
 *   }, html\`<div><p class="font-medium">Tan Nguyen</p><p class="text-sm text-muted-foreground">Admin</p></div>\`)}
 */
@Component()
export class Item extends Cossack {
    declare props: ItemProps;

    render() {
        const {
            media,
            trailing,
            divider = true,
            interactive = false,
            compact = false,
            ...rest
        } = this.props;

        return html`
            <div
                class=${classMap({
                    "cs-item": true,
                    "flex items-center gap-3 w-full": true,
                    "px-3": true,
                    "py-2.5": !compact,
                    "py-1.5": compact,
                    "border-b border-border": divider,
                    "hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]": interactive,
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
