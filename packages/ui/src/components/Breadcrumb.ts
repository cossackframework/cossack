import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface BreadcrumbProps {
    /** Items: [{ label, href }]. The last item is rendered as current page. */
    items?: Array<{ label: unknown; href?: string }>;
    /** Separator between items. Default '>'. */
    separator?: string;
    [key: string]: any;
}

/**
 * Cossack UI Breadcrumb — navigation trail using `<nav>` + `<ol>`.
 *
 *   ${component(Breadcrumb, { items: [
 *       { label: 'Home', href: '/' },
 *       { label: 'Settings', href: '/settings' },
 *       { label: 'Profile' },
 *   ]})}
 */
@Component()
export class Breadcrumb extends Cossack {
    declare props: BreadcrumbProps;

    render() {
        const { items = [], separator = "/" } = this.props;

        return html`
            <nav class="cs-breadcrumb" aria-label="Breadcrumb">
                <ol class="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground break-all">
                    ${items.map((item, i) => {
                        const isLast = i === items.length - 1;
                        return html`
                            <li class="cs-breadcrumb__item inline-flex items-center gap-1.5">
                                ${item.href && !isLast
                                    ? html`<a href=${item.href} class="cs-breadcrumb__link hover:text-foreground transition-colors">${item.label}</a>`
                                    : html`<span class=${classMap({ "cs-breadcrumb__current text-foreground font-medium": isLast })}>${item.label}</span>`}
                                ${!isLast ? html`<span class="cs-breadcrumb__separator text-muted-foreground/50">${separator}</span>` : null}
                            </li>
                        `;
                    })}
                </ol>
            </nav>
        `;
    }
}
