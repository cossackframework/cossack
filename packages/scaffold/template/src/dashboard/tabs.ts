/** Tab helpers shared by the dashboard's screens: a count beside a label, and the open tab kept in the address. */
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Badge } from '@cossackframework/ui';

/** A count beside a label, such as a tab's items; nothing when there are none, so an empty tab stays quiet. */
export function countBadge(count: number): TemplateResult {
    if (!count) return html``;
    return html`<span class="ml-1.5 inline-flex align-middle">${component(Badge, { variant: 'default' }, String(count))}</span>`;
}

/** The tab the address names (`?tab=`), when it is one of `values`; the first value otherwise. */
export function tabFromQuery<T extends string>(query: string | undefined, values: readonly T[]): T {
    return values.find(value => value === query) ?? values[0]!;
}

/**
 * Keep the open tab in the address so a reload or a shared link opens it; the first (default)
 * tab drops the parameter. Client only: replaces the history entry.
 */
export function rememberTab(value: string, values: readonly string[], name = 'tab'): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (value === values[0]) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    window.history.replaceState(window.history.state, '', url);
}
