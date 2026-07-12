import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface TableProps {
    /** Render a striped table (alternating row backgrounds). */
    striped?: boolean;
    /** Allow arbitrary HTML attributes to spread onto the wrapper. */
    [key: string]: any;
}

/**
 * Cossack UI Table — token-styled wrapper around the native `<table>` element.
 *
 * Pass the full table markup (`<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`) as
 * children. The wrapper applies border, padding, and header styling via CSS
 * targeting the descendant elements, so you write standard HTML.
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
        const { striped = false, ...rest } = this.props;

        const wrapperClasses = classMap({
            "cs-table": true,
            "cs-table--striped": striped,
            "w-full overflow-auto": true,
        });

        return html`
            <div class=${wrapperClasses} ...=${rest}>
                <table class="cs-table__element w-full text-sm text-left">
                    ${this.children}
                </table>
            </div>
        `;
    }
}

/** Convenience: styled `<thead>`. */
@Component()
export class TableHeader extends Cossack {
    declare props: { [key: string]: any };
    render() {
        return html`<thead class="cs-table__header text-xs uppercase text-muted-foreground" ...=${this.props}>${this.children}</thead>`;
    }
}

/** Convenience: styled `<tbody>`. */
@Component()
export class TableBody extends Cossack {
    declare props: { [key: string]: any };
    render() {
        return html`<tbody class="cs-table__body" ...=${this.props}>${this.children}</tbody>`;
    }
}

/** Convenience: styled `<tr>`. */
@Component()
export class TableRow extends Cossack {
    declare props: { [key: string]: any };
    render() {
        return html`<tr class="cs-table__row border-b border-border" ...=${this.props}>${this.children}</tr>`;
    }
}

/** Convenience: styled `<th>`. */
@Component()
export class TableHead extends Cossack {
    declare props: { [key: string]: any };
    render() {
        return html`<th class="cs-table__head px-4 py-3 font-medium" ...=${this.props}>${this.children}</th>`;
    }
}

/** Convenience: styled `<td>`. */
@Component()
export class TableCell extends Cossack {
    declare props: { [key: string]: any };
    render() {
        return html`<td class="cs-table__cell px-4 py-3" ...=${this.props}>${this.children}</td>`;
    }
}
