import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface PaginationProps {
    /** Current page (1-based). */
    page: number;
    /** Total number of pages. */
    totalPages: number;
    /** Callback when page changes. */
    onPageChange?: (page: number) => void;
    /** Max number of page buttons to show. Default 5. */
    maxButtons?: number;
    [key: string]: any;
}

/**
 * Cossack UI Pagination — page navigation using `<nav>` + buttons.
 *
 *   ${component(Pagination, {
 *       page: this.page, totalPages: 10,
 *       onPageChange: (p) => this.page = p,
 *   })}
 */
@Component()
export class Pagination extends Cossack {
    declare props: PaginationProps;

    render() {
        const { page, totalPages, maxButtons = 5 } = this.props;

        // Calculate the range of page buttons to show.
        const half = Math.floor(maxButtons / 2);
        let start = Math.max(1, page - half);
        const end = Math.min(totalPages, start + maxButtons - 1);
        start = Math.max(1, end - maxButtons + 1);
        const pages: number[] = [];
        for (let i = start; i <= end; i++) pages.push(i);

        const btnClass = (active: boolean) => classMap({
            "cs-pagination__button": true,
            "inline-flex items-center justify-center w-9 h-9 text-sm rounded-md cursor-pointer border-none transition-colors": true,
            "bg-primary text-primary-foreground": active,
            "text-foreground hover:bg-muted": !active,
        });

        return html`
            <nav class="cs-pagination flex items-center gap-1" aria-label="Pagination">
                <button type="button" class=${btnClass(false)} ?disabled=${page <= 1}
                    @click=${() => this.props.onPageChange?.(page - 1)} aria-label="Previous page">‹</button>
                ${start > 1 ? html`
                    <button type="button" class=${btnClass(false)} @click=${() => this.props.onPageChange?.(1)}>1</button>
                    ${start > 2 ? html`<span class="px-1 text-muted-foreground">…</span>` : null}
                ` : null}
                ${pages.map((p) => html`
                    <button type="button" class=${btnClass(p === page)} aria-current=${p === page ? "page" : "false"}
                        @click=${() => this.props.onPageChange?.(p)}>${p}</button>
                `)}
                ${end < totalPages ? html`
                    ${end < totalPages - 1 ? html`<span class="px-1 text-muted-foreground">…</span>` : null}
                    <button type="button" class=${btnClass(false)} @click=${() => this.props.onPageChange?.(totalPages)}>${totalPages}</button>
                ` : null}
                <button type="button" class=${btnClass(false)} ?disabled=${page >= totalPages}
                    @click=${() => this.props.onPageChange?.(page + 1)} aria-label="Next page">›</button>
            </nav>
        `;
    }
}
