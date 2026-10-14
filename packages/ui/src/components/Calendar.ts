import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component, Client, ClientState } from "@cossackframework/core";
import type { GlobalAttributes, ControlEvent } from "../native-attributes";
import { ControlledValue } from "../native-attributes";
import { parseDate, isoDate, dateFromParts, dateRange, clampDate, monthDays, shiftDays, shiftMonths, dateLabel } from "../internal/date";

export type CalendarProps = Omit<GlobalAttributes<HTMLDivElement>, 'id' | 'role'> & {
    /** Stable page-unique ID for the calendar and month heading. */
    id: string;
    /** Controlled selected date, yyyy-mm-dd or empty. */
    value?: string;
    defaultValue?: string;
    min?: string;
    max?: string;
    disabled?: boolean;
    /** Allow navigation but prevent selection. */
    readonly?: boolean;
    onChange?: (iso: string) => unknown;
    /** Every accepted user pick, including the already selected date. */
    onSelect?: (iso: string) => unknown;
    /** Explicit Gregorian locale. Default en-US. */
    locale?: string;
    /** Sunday=0 through Saturday=6. Default Sunday. */
    weekStartsOn?: number;
    /**
     * Reference day for initial focus and the today marker. When omitted, the
     * viewer's current UTC day is resolved once after mount, so server and
     * hydration renders agree; until then the current month is shown unmarked.
     */
    today?: string;
    previousLabel?: string;
    nextLabel?: string;
};

/** A Gregorian date grid with one day in the tab order and bounded keyboard navigation. */
const utcToday = () => new Date().toISOString().slice(0, 10);

@Component()
export class Calendar extends Cossack {
    declare props: CalendarProps;
    @ClientState() private draft: string | undefined;
    @ClientState() private cursor: string | undefined;
    @ClientState() private clientToday: string | undefined;
    private initialValue: string | undefined;
    private cursorOwner: string | undefined;
    private root?: HTMLDivElement;
    private controlled = new ControlledValue<string>();
    private get selected() { this.initialValue ??= this.props.defaultValue ?? ''; return this.props.value ?? this.draft ?? this.initialValue; }
    private get referenceDay(): string | undefined { return this.props.today || this.clientToday; }
    /** Day that anchors the shown month: the reference day, or the first of the current UTC month before mount. */
    private get anchorDay() { return this.referenceDay ?? `${utcToday().slice(0, 7)}-01`; }
    private get contextKey() { return JSON.stringify([this.selected, this.props.min, this.props.max, this.referenceDay]); }
    private get focusedDate() {
        const range = dateRange(this.props.min, this.props.max);
        return clampDate(this.cursorOwner === this.contextKey && this.cursor ? this.cursor : this.selected || this.anchorDay, range.first, range.last);
    }

    render() {
        const { id, value: _value, defaultValue: _default, min, max, disabled = false, readonly = false, onChange: _change, onSelect: _select,
            locale = 'en-US', weekStartsOn = 0, today: _today, previousLabel = 'Previous month', nextLabel = 'Next month', ...rest } = this.props;
        if (typeof id !== 'string' || !id || /\s/.test(id)) throw new Error('Calendar requires a nonempty, whitespace-free id.');
        if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) throw new RangeError('Calendar weekStartsOn must be an integer from 0 to 6.');
        parseDate(this.selected, 'value'); parseDate(this.props.today, 'today');
        const range = dateRange(min, max), focus = this.focusedDate, date = parseDate(focus)!;
        const year = date.getUTCFullYear(), month = date.getUTCMonth() + 1, first = dateFromParts(year, month, 1);
        const padding = (first.getUTCDay() - weekStartsOn + 7) % 7, count = monthDays(year, month);
        const cells = Array.from({ length: Math.ceil((padding + count) / 7) * 7 }, (_, i) => i < padding || i >= padding + count ? undefined : isoDate(dateFromParts(year, month, i - padding + 1)));
        const dayNumber = new Intl.NumberFormat(locale);
        const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: 'full', calendar: 'gregory', timeZone: 'UTC' });
        const longWeekday = new Intl.DateTimeFormat(locale, { weekday: 'long', calendar: 'gregory', timeZone: 'UTC' });
        const shortWeekday = new Intl.DateTimeFormat(locale, { weekday: 'short', calendar: 'gregory', timeZone: 'UTC' });
        const rows = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
        const previous = clampDate(shiftMonths(focus, -1), range.first, range.last), next = clampDate(shiftMonths(focus, 1), range.first, range.last);
        return html`<div ref=${(element: Element) => this.connect(element as HTMLDivElement)} id=${id} role="group" aria-label="Calendar"
            class="cs-calendar inline-block rounded-lg border bg-popover text-popover-foreground p-3 select-none" ...=${rest}>
            <div class="cs-calendar__header flex items-center justify-between mb-3 gap-2">
                <button type="button" aria-label=${previousLabel} ?disabled=${disabled || previous.slice(0, 7) === focus.slice(0, 7)}
                    class="cs-calendar__prev size-8 rounded-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
                    @click=${(event: ControlEvent<HTMLButtonElement, MouseEvent>) => this.move(previous, event.currentTarget, false)}><span aria-hidden="true">‹</span></button>
                <span id=${`${id}-month`} aria-live="polite" aria-atomic="true" class="cs-calendar__title text-sm font-medium">${dateLabel(focus, locale, { year: 'numeric', month: 'long' })}</span>
                <button type="button" aria-label=${nextLabel} ?disabled=${disabled || next.slice(0, 7) === focus.slice(0, 7)}
                    class="cs-calendar__next size-8 rounded-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
                    @click=${(event: ControlEvent<HTMLButtonElement, MouseEvent>) => this.move(next, event.currentTarget, false)}><span aria-hidden="true">›</span></button>
            </div>
            <table role="grid" aria-labelledby=${`${id}-month`} aria-readonly=${String(readonly)} class="cs-calendar__grid border-separate border-spacing-1">
                <thead><tr>${Array.from({ length: 7 }, (_, i) => {
                    const weekday = dateFromParts(2024, 1, 7 + (weekStartsOn + i) % 7);
                    return html`<th scope="col" abbr=${longWeekday.format(weekday)} class="text-xs font-medium text-muted-foreground size-8">${shortWeekday.format(weekday)}</th>`;
                })}</tr></thead>
                <tbody>${rows.map(row => html`<tr>${row.map(iso => iso ? html`<td aria-selected=${iso === this.selected ? 'true' : undefined}>
                    <button type="button" data-date=${iso} tabindex=${iso === focus ? 0 : -1} aria-label=${fullDate.format(parseDate(iso)!)} aria-current=${iso === this.referenceDay ? 'date' : undefined}
                        ?disabled=${disabled || iso < range.first || iso > range.last}
                        class=${classMap({ 'cs-calendar__day size-8 rounded-md text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 disabled:cursor-not-allowed': true,
                            'bg-primary text-primary-foreground': iso === this.selected,
                            'bg-accent text-accent-foreground': iso !== this.selected && iso === this.referenceDay,
                            'hover:bg-accent hover:text-accent-foreground': iso !== this.selected && iso !== this.referenceDay })}
                        @focus=${() => { this.cursorOwner = this.contextKey; this.cursor = iso; }}
                        @keydown=${(event: ControlEvent<HTMLButtonElement, KeyboardEvent>) => this.keydown(event)}
                        @click=${(event: ControlEvent<HTMLButtonElement, MouseEvent>) => this.select(iso, event.currentTarget)}>${dayNumber.format(parseDate(iso)!.getUTCDate())}</button>
                </td>` : html`<td></td>`)}</tr>`)}</tbody>
            </table>
        </div>`;
    }

    @Client()
    private connect(root: HTMLDivElement) {
        this.root = root;
        // Resolve "today" on the client only, after the hydrating render matched the server.
        if (!this.props.today && this.clientToday === undefined) queueMicrotask(() => {
            if (this.root === root && this.clientToday === undefined) this.clientToday = utcToday();
        });
        const previous = root.ownerDocument.activeElement;
        const ownedFocus = previous instanceof HTMLButtonElement && root.contains(previous) && !!previous.dataset.date;
        queueMicrotask(() => {
            if (this.root !== root || !root.isConnected || this.props.disabled) return;
            const active = root.ownerDocument.activeElement;
            const changedDay = active instanceof HTMLButtonElement && root.contains(active) && active.dataset.date && active.dataset.date !== this.focusedDate;
            if (changedDay || (ownedFocus && active === root.ownerDocument.body)) {
                root.querySelector<HTMLButtonElement>(`button[data-date="${this.focusedDate}"]:not(:disabled)`)?.focus();
            }
        });
    }

    @Client()
    private async move(iso: string, source: HTMLButtonElement, focus: boolean) {
        if (this.props.disabled || source.matches(':disabled')) return;
        const range = dateRange(this.props.min, this.props.max), root = this.root;
        const ownedFocus = source.ownerDocument.activeElement === source;
        this.cursorOwner = this.contextKey;
        this.cursor = clampDate(iso, range.first, range.last);
        await this.requestUpdate();
        if (!root?.isConnected || this.root !== root || this.props.disabled) return;
        const document = root.ownerDocument;
        if (document.activeElement !== source && !(document.activeElement === document.body && ownedFocus)) return;
        if (focus || source.matches(':disabled')) root.querySelector<HTMLButtonElement>(`button[data-date="${this.focusedDate}"]:not(:disabled)`)?.focus();
    }
    @Client()
    private keydown(event: ControlEvent<HTMLButtonElement, KeyboardEvent>) {
        if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.currentTarget.matches(':disabled')) return;
        // Repeated keys can arrive before the previous render commits its DOM focus.
        const current = this.focusedDate;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.select(current, event.currentTarget);
            return;
        }
        const weekday = (parseDate(current)!.getUTCDay() - (this.props.weekStartsOn ?? 0) + 7) % 7;
        const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
        let next: string;
        switch (event.key) {
            case 'ArrowLeft': next = shiftDays(current, rtl ? 1 : -1); break;
            case 'ArrowRight': next = shiftDays(current, rtl ? -1 : 1); break;
            case 'ArrowUp': next = shiftDays(current, -7); break;
            case 'ArrowDown': next = shiftDays(current, 7); break;
            case 'Home': next = shiftDays(current, -weekday); break;
            case 'End': next = shiftDays(current, 6 - weekday); break;
            case 'PageUp': next = shiftMonths(current, event.shiftKey ? -12 : -1); break;
            case 'PageDown': next = shiftMonths(current, event.shiftKey ? 12 : 1); break;
            default: return;
        }
        event.preventDefault();
        void this.move(next, event.currentTarget, true);
    }
    @Client()
    private select(iso: string, source: HTMLButtonElement) {
        const range = dateRange(this.props.min, this.props.max);
        if (this.props.disabled || this.props.readonly || source.matches(':disabled') || iso < range.first || iso > range.last) return;
        const changed = this.controlled.changed(this.props, this.selected, iso);
        this.draft = iso;
        if (changed) this.props.onChange?.(this.controlled.emit(this.props, iso));
        this.props.onSelect?.(iso);
        this.cursorOwner = this.contextKey;
        this.cursor = iso;
        void this.requestUpdate();
    }
    onCleanup() { this.root = undefined; }
}
