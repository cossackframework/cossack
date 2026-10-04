import { html, repeat } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';
import type { GlobalAttributes, AnchorAttributes } from '../native-attributes';

export type BreadcrumbLinkProps = Omit<AnchorAttributes, 'href' | 'role' | 'tabindex' | 'aria-current' | 'aria-label' | 'aria-labelledby'>;
export type BreadcrumbTextProps = Omit<GlobalAttributes<HTMLSpanElement>, 'role' | 'tabindex' | 'aria-current' | 'aria-label' | 'aria-labelledby'>;
export type BreadcrumbListProps = Omit<GlobalAttributes<HTMLOListElement>, 'role' | 'tabindex'>;
export type BreadcrumbItem = { value: string } &
    ({ label: string; ariaLabel?: string } | { label: unknown; ariaLabel: string }) &
    ({ href: string; linkProps?: BreadcrumbLinkProps; textProps?: never } |
     { href?: undefined; textProps?: BreadcrumbTextProps; linkProps?: never });
export type BreadcrumbProps = Omit<GlobalAttributes<HTMLElement>, 'role' | 'tabindex' | 'aria-label' | 'aria-labelledby'> & {
    /** Accessible name of the navigation landmark. Default: Breadcrumb. */
    label?: string;
    /** Stable items in hierarchy order. The final item is the current page. */
    items?: readonly BreadcrumbItem[];
    /** Decorative text between items. Default: /. */
    separator?: string;
    listProps?: BreadcrumbListProps;
};

/** Native navigation trail with stable item identity and optional current-page links. */
@Component()
export class Breadcrumb extends Cossack {
    declare props: BreadcrumbProps;
    private root?: HTMLElement;
    private links = new Map<string, HTMLAnchorElement>();
    private generation = 0;

    render() {
        const { items = [], label = 'Breadcrumb', separator = '/', listProps, ...rest } = this.props;
        if (typeof label !== 'string' || !label.trim() || typeof separator !== 'string') throw new Error('Breadcrumb requires a nonempty label and a text separator.');
        const values = new Set<string>();
        for (const item of items) {
            const name = item.ariaLabel === undefined ? item.label : item.ariaLabel;
            if (typeof item.value !== 'string' || !item.value || values.has(item.value)) throw new Error('Breadcrumb items require unique nonempty values.');
            if (typeof name !== 'string' || !name.trim()) throw new Error('Breadcrumb items require text labels or a nonempty ariaLabel.');
            if (item.href !== undefined ? typeof item.href !== 'string' || !item.href.trim() || item.textProps !== undefined : item.linkProps !== undefined) throw new Error('Breadcrumb requires nonempty hrefs and separate linkProps/textProps targets.');
            values.add(item.value);
        }
        const active = this.root?.ownerDocument.activeElement;
        const ownedFocus = active && this.root?.contains(active) ? active as HTMLElement : undefined;
        for (const key of this.links.keys()) if (!items.some(item => item.value === key && item.href !== undefined)) this.links.delete(key);
        const generation = ++this.generation;
        const connect = (element: Element) => {
            this.root = element as HTMLElement;
            queueMicrotask(() => {
                if (generation !== this.generation || !this.root?.isConnected || !ownedFocus) return;
                const focused = this.root.ownerDocument.activeElement;
                if (focused !== ownedFocus && focused !== this.root.ownerDocument.body) return;
                const available = (link?: HTMLElement): link is HTMLElement => !!link?.isConnected && link.matches('a[href]') && link.getClientRects().length > 0 && !link.closest('[hidden],[inert]');
                if (available(ownedFocus)) ownedFocus.focus({ preventScroll: true });
                else (items.map(item => this.links.get(item.value)).find(available) ?? this.root).focus({ preventScroll: true });
            });
        };
        return html`<nav ref=${connect} class="cs-breadcrumb" aria-label=${label} tabindex="-1" ...=${rest}>
            <ol class="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground break-all" ...=${listProps}>
                ${repeat(items, item => item.value, (item, index) => {
                    const current = index === items.length - 1;
                    const currentClass = current ? 'cs-breadcrumb__current text-foreground font-medium' : '';
                    return html`<li class="cs-breadcrumb__item inline-flex items-center gap-1.5">
                        ${item.href !== undefined
                            ? html`<a ref=${(element: Element) => this.links.set(item.value, element as HTMLAnchorElement)} href=${item.href} aria-label=${item.ariaLabel} aria-current=${current ? 'page' : undefined}
                                class=${`cs-breadcrumb__link hover:text-foreground transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-sm ${currentClass}`} ...=${item.linkProps}>${item.label}</a>`
                            : html`<span class=${currentClass} aria-current=${current ? 'page' : undefined} ...=${item.textProps}>${item.ariaLabel === undefined ? item.label : html`<span aria-hidden="true">${item.label}</span><span class="sr-only">${item.ariaLabel}</span>`}</span>`}
                        ${!current ? html`<span aria-hidden="true" class="cs-breadcrumb__separator text-muted-foreground/50">${separator}</span>` : null}
                    </li>`;
                })}
            </ol>
        </nav>`;
    }
    onCleanup() { this.generation++; this.links.clear(); this.root = undefined; }
}
