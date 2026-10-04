import { html, component, repeat, PreventDefaultResult, preventDefault, type nothing } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';
import type { GlobalAttributes, ButtonAttributes, AnchorAttributes, ControlEvent } from '../native-attributes';
import { Icon } from '../icons/Icon';
import { AltArrowLeftIcon as altArrowLeftIcon } from '@cossackframework/solar-icons/alt-arrow-left';
import { AltArrowRightIcon as altArrowRightIcon } from '@cossackframework/solar-icons/alt-arrow-right';

export type PaginationButtonProps = Omit<ButtonAttributes, 'id' | 'type' | 'role' | 'tabindex' | 'disabled' | '?disabled' | 'aria-disabled' | 'aria-current' | 'aria-label' | 'aria-labelledby' | 'popovertarget' | 'popovertargetaction'>;
export type PaginationLinkProps = Omit<AnchorAttributes, 'id' | 'href' | 'role' | 'tabindex' | 'aria-disabled' | 'aria-current' | 'aria-label' | 'aria-labelledby'>;
type PaginationBase = Omit<GlobalAttributes<HTMLElement>, 'role' | 'tabindex' | 'aria-label' | 'aria-labelledby'> & {
    /** Controlled page (1-based); values above the current count display the last page. */
    page: number;
    /** Zero means there are no pages. */
    totalPages: number;
    /** Sliding window size, excluding first/last shortcuts. Integer 1–100; default 5. */
    maxButtons?: number;
    label?: string;
    previousLabel?: string;
    nextLabel?: string;
    pageLabel?: (page: number) => string;
    disabled?: boolean;
};
export type PaginationProps = PaginationBase & ({
    onPageChange: (page: number) => unknown;
    buttonProps?: PaginationButtonProps;
    href?: never;
    linkProps?: never;
} | {
    /** Native navigation; retains open-in-new-tab and modified-click behavior. */
    href: (page: number) => string;
    linkProps?: PaginationLinkProps;
    onPageChange?: never;
    buttonProps?: never;
});
type PageControl = { key: string; page: number; label: string; current: boolean; disabled: boolean; edge?: 'previous' | 'next' };
type PageEntry = PageControl | { key: string; gap: true };
type PaginationListener = ((event: ControlEvent<HTMLButtonElement, PointerEvent>) => unknown) | ((event: ControlEvent<HTMLAnchorElement, PointerEvent>) => unknown) | PreventDefaultResult | null | typeof nothing | undefined;

/** Controlled page selection or native URL navigation with ordinary Tab behavior. */
@Component()
export class Pagination extends Cossack {
    declare props: PaginationProps;
    private root?: HTMLElement;
    private controls = new Map<string, HTMLElement>();
    private generation = 0;

    render() {
        const { page, totalPages, maxButtons = 5, label = 'Pagination', previousLabel = 'Previous page', nextLabel = 'Next page', pageLabel = (value: number) => `Page ${value}`, disabled = false, href, onPageChange, buttonProps, linkProps, ...rest } = this.props;
        if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(totalPages) || totalPages < 0 || !Number.isInteger(maxButtons) || maxButtons < 1 || maxButtons > 100) throw new Error('Pagination requires a positive safe page, a nonnegative safe totalPages and maxButtons from 1 to 100.');
        if ([label, previousLabel, nextLabel].some(value => typeof value !== 'string' || !value.trim()) || typeof pageLabel !== 'function') throw new Error('Pagination requires nonempty navigation and control labels.');
        if (href !== undefined ? typeof href !== 'function' || onPageChange !== undefined || buttonProps !== undefined : typeof onPageChange !== 'function' || linkProps !== undefined) throw new Error('Pagination requires either href/linkProps or onPageChange/buttonProps.');
        const current = Math.min(page, totalPages), end = Math.min(totalPages, Math.max(1, current - Math.floor(maxButtons / 2)) + maxButtons - 1), start = Math.max(1, end - maxButtons + 1);
        const entries: PageEntry[] = [{ key: 'previous', page: Math.max(1, current - 1), label: previousLabel, current: false, disabled: disabled || current <= 1, edge: 'previous' }];
        const addPage = (value: number) => {
            const name = pageLabel(value);
            if (typeof name !== 'string' || !name.trim()) throw new Error('Pagination pageLabel must return nonempty text.');
            entries.push({ key: `page:${value}`, page: value, label: name, current: value === current, disabled });
        };
        if (totalPages > 0) {
            if (start > 1) addPage(1);
            if (start > 2) entries.push({ key: 'gap:start', gap: true });
            for (let value = start; value <= end; value++) addPage(value);
            if (end < totalPages - 1) entries.push({ key: 'gap:end', gap: true });
            if (end < totalPages) addPage(totalPages);
        }
        entries.push({ key: 'next', page: Math.min(totalPages, current + 1), label: nextLabel, current: false, disabled: disabled || current >= totalPages, edge: 'next' });
        const active = this.root?.ownerDocument.activeElement;
        const ownedFocus = active && this.root?.contains(active) ? active as HTMLElement : undefined;
        const keys = new Set(entries.map(entry => entry.key));
        for (const key of this.controls.keys()) if (!keys.has(key)) this.controls.delete(key);
        const generation = ++this.generation;
        const connect = (element: Element) => {
            this.root = element as HTMLElement;
            queueMicrotask(() => {
                if (generation !== this.generation || !this.root?.isConnected || !ownedFocus) return;
                const focused = this.root.ownerDocument.activeElement;
                if (focused !== ownedFocus && focused !== this.root.ownerDocument.body) return;
                const available = (control?: HTMLElement): control is HTMLElement => !!control?.isConnected && !control.matches(':disabled,[aria-disabled="true"],[hidden],[inert]');
                if (available(ownedFocus)) ownedFocus.focus({ preventScroll: true });
                else (Array.from([this.controls.get(`page:${current}`), ...this.controls.values()]).find(available) ?? this.root).focus({ preventScroll: true });
            });
        };
        const renderControl = (control: PageControl) => {
            const props = href ? linkProps : buttonProps;
            const supplied: PaginationListener = props?.['@click'];
            const click: EventListener = event => {
                if (control.disabled || (event.currentTarget as HTMLElement).matches(':disabled')) { event.preventDefault(); return; }
                if (typeof supplied === 'function') (supplied as (event: Event) => unknown)(event);
                else if (supplied instanceof PreventDefaultResult) supplied.handler.call(event.currentTarget, event);
                if (!href && !event.defaultPrevented && control.page !== current) onPageChange?.(control.page);
            };
            const attributes = { ...props, '@click': supplied instanceof PreventDefaultResult ? preventDefault(click, { novalidate: supplied.novalidate }) : click };
            const classes = `cs-pagination__button inline-flex items-center justify-center w-9 h-9 text-sm rounded-md cursor-pointer border-none transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${control.current ? 'bg-primary text-primary-foreground' : 'hover:bg-accent hover:text-accent-foreground'}`;
            const content = control.edge ? html`<span aria-hidden="true" class="inline-flex items-center justify-center [&_svg]:size-4 rtl:rotate-180">${component(Icon, { entry: control.edge === 'previous' ? altArrowLeftIcon : altArrowRightIcon, size: 16 })}</span>` : control.page;
            const ref = (element: Element) => { this.controls.set(control.key, element as HTMLElement); };
            if (href) {
                const url = control.disabled ? undefined : href(control.page);
                if (!control.disabled && (typeof url !== 'string' || !url.trim())) throw new Error('Pagination href must return a nonempty URL.');
                return html`<a ref=${ref} class=${classes} href=${url} role=${control.disabled ? 'link' : undefined} aria-label=${control.label} aria-current=${control.current ? 'page' : undefined} aria-disabled=${control.disabled ? 'true' : undefined} tabindex=${control.disabled ? -1 : undefined} ...=${attributes}>${content}</a>`;
            }
            return html`<button ref=${ref} type="button" class=${classes} ?disabled=${control.disabled} aria-label=${control.label} aria-current=${control.current ? 'page' : undefined} ...=${attributes}>${content}</button>`;
        };
        return html`<nav ref=${connect} class="cs-pagination flex items-center gap-1" aria-label=${label} tabindex="-1" ...=${rest}>${repeat(entries, entry => entry.key, entry => 'gap' in entry ? html`<span aria-hidden="true" class="px-1 text-muted-foreground">…</span>` : renderControl(entry))}</nav>`;
    }
    onCleanup() { this.generation++; this.controls.clear(); this.root = undefined; }
}
