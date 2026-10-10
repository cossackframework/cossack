import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

import type { GlobalAttributes, TableCellAttributes, TableHeadAttributes } from "../native-attributes";

export type TableProps = GlobalAttributes<HTMLTableElement> & {
    /** Render a striped table (alternating row backgrounds). */
    striped?: boolean;
    /** Attributes/events for the overflow wrapper; top-level props target the table. */
    wrapperProps?: GlobalAttributes<HTMLDivElement>;
};

/**
 * Cossack UI Table — token-styled wrapper around the native `<table>` element.
 *
 * Pass the full table markup (`<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`) as
 * children. Top-level attributes and events target the table. Use wrapperProps
 * for overflow styling and optional named keyboard access. Name the table with
 * a caption or aria-label. Rows retain native table semantics, not grid behavior.
 *
 *   ${component(Table, { striped: true }, html\`
 *     <thead><tr><th>Name</th><th>Email</th></tr></thead>
 *     <tbody>
 *       <tr><td>Tan</td><td>tan@ex.com</td></tr>
 *     </tbody>
 *   \`)}
 */
@Component()
export class Table extends Cossack {
    declare props: TableProps;

    render() {
        const { striped = false, wrapperProps, ...rest } = this.props;
        if (typeof striped !== "boolean") throw new Error("Table striped must be a boolean.");

        const wrapperClasses = classMap({
            "cs-table": true,
            "cs-table--striped": striped,
            "w-full overflow-auto rounded-lg border bg-card text-card-foreground": true,
        });

        return html`
            <div class=${wrapperClasses} ...=${wrapperProps}>
                <table class=${classMap({
                    "cs-table__element w-full caption-bottom text-sm [&>thead]:bg-muted/50 [&_th]:px-4 [&_th]:py-3 [&_th]:text-left [&_td]:px-4 [&_td]:py-3 [&_tr]:border-b": true,
                    "[&>tbody>tr:nth-child(even)]:bg-muted/50": striped,
                })} ...=${rest}>
                    ${this.children}
                </table>
            </div>
        `;
    }
}

/** Convenience: styled `<thead>`. */
@Component()
export class TableHeader extends Cossack {
    declare props: GlobalAttributes<HTMLTableSectionElement>;
    render() {
        return html`<thead class="cs-table__header [&_tr]:border-b bg-muted/50" ...=${this.props}>${this.children}</thead>`;
    }
}

/** Convenience: styled `<tbody>`. */
@Component()
export class TableBody extends Cossack {
    declare props: GlobalAttributes<HTMLTableSectionElement>;
    render() {
        return html`<tbody class="cs-table__body" ...=${this.props}>${this.children}</tbody>`;
    }
}

/** Convenience: styled `<tr>`. */
@Component()
export class TableRow extends Cossack {
    declare props: GlobalAttributes<HTMLTableRowElement>;
    render() {
        return html`<tr class="cs-table__row border-b transition-colors motion-reduce:transition-none hover:bg-muted/50" ...=${this.props}>${this.children}</tr>`;
    }
}

/** Convenience: styled `<th>`. */
@Component()
export class TableHead extends Cossack {
    declare props: TableHeadAttributes;
    render() {
        return html`<th class="cs-table__head h-10 px-4 text-left align-middle font-medium text-muted-foreground" ...=${this.props}>${this.children}</th>`;
    }
}

/** Convenience: styled `<td>`. */
@Component()
export class TableCell extends Cossack {
    declare props: TableCellAttributes;
    render() {
        return html`<td class="cs-table__cell px-4 py-3" ...=${this.props}>${this.children}</td>`;
    }
}
