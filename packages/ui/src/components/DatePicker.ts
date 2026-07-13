import { html, classMap } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    Client,
    ClientState,
    createRef,
    type RefObject,
} from "@cossackframework/core";

export interface DatePickerProps {
    /** Selected date (ISO yyyy-mm-dd). */
    value?: string;
    /** Input placeholder. */
    placeholder?: string;
    /** Earliest selectable date (ISO). */
    min?: string;
    /** Latest selectable date (ISO). */
    max?: string;
    /** Called when a date is picked. */
    onChange?: (iso: string) => void;
    [key: string]: any;
}

/** Human-readable date label, e.g. "Jan 5, 2025". */
function formatLabel(iso?: string): string {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return "";
    return new Date(y, m - 1, d).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

/**
 * Cossack UI DatePicker — a Calendar inside a native popover.
 *
 * Click the input to open a positioned calendar; picking a date closes it and
 * fires `onChange` with an ISO `yyyy-mm-dd` string.
 *
 *   ${component(DatePicker, {
 *       value: this.dueDate,
 *       onChange: (iso) => { this.dueDate = iso; },
 *   })}
 */
@Component()
export class DatePicker extends Cossack {
    declare props: DatePickerProps;

    @ClientState() private isOpen = false;
    @ClientState() private inner: string | undefined = undefined;

    inputRef: RefObject<HTMLButtonElement> = createRef<HTMLButtonElement>();
    private popoverId = `cs-datepicker-${Math.random().toString(36).slice(2, 9)}`;

    render() {
        const { placeholder = "Pick a date" } = this.props;
        const current = this.inner ?? this.props.value;

        return html`
            <div class="cs-datepicker relative inline-block w-full">
                <button
                    type="button"
                    ref=${this.inputRef}
                    popovertarget=${this.popoverId}
                    class=${classMap({
                        "cs-datepicker__trigger": true,
                        "w-full inline-flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm cursor-pointer transition-colors": true,
                        "text-muted-foreground": !current,
                        "text-foreground": !!current,
                        "hover:bg-muted": true,
                    })}
                    @click=${() => this.position()}
                >
                    <span>${current ? formatLabel(current) : placeholder}</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" class="text-muted-foreground">
                        <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/>
                        <path d="M3 10h18M8 2v4M16 2v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                </button>
                <div
                    id=${this.popoverId}
                    popover="auto"
                    class="cs-datepicker__panel"
                    style="position:fixed;margin:0;background:transparent;border:none;padding:0;"
                    @toggle=${(e: Event) => this.onToggle(e)}
                >
                    <div class="bg-background border border-border rounded-lg shadow-lg p-2 mt-1">
                        ${this.renderCalendar(current)}
                    </div>
                </div>
            </div>
        `;
    }

    /** Inline calendar markup — avoids a circular import with Calendar.ts. */
    private renderCalendar(current: string | undefined) {
        const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
        const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const sel = current ? new Date(Number(current.slice(0, 4)), Number(current.slice(5, 7)) - 1, Number(current.slice(8, 10))) : null;

        const first = new Date(this.viewYear, this.viewMonth, 1);
        const startWd = first.getDay();
        const dim = new Date(this.viewYear, this.viewMonth + 1, 0).getDate();
        const cells: Array<{ d: number; date: Date } | null> = [];
        for (let i = 0; i < startWd; i++) cells.push(null);
        for (let d = 1; d <= dim; d++) cells.push({ d, date: new Date(this.viewYear, this.viewMonth, d) });

        return html`
            <div class="inline-block p-1 select-none">
                <div class="flex items-center justify-between mb-2 px-1">
                    <button type="button" class="inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-muted cursor-pointer border-none bg-transparent" @click=${() => this.prevMonth()}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <span class="text-sm font-medium text-foreground">${MONTHS[this.viewMonth]} ${this.viewYear}</span>
                    <button type="button" class="inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-muted cursor-pointer border-none bg-transparent" @click=${() => this.nextMonth()}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                </div>
                <div class="grid grid-cols-7 gap-0.5 mb-1">
                    ${WEEKDAYS.map((wd) => html`<span class="text-[10px] font-medium text-muted-foreground text-center w-7 h-6 flex items-center justify-center">${wd}</span>`)}
                </div>
                <div class="grid grid-cols-7 gap-0.5">
                    ${cells.map((c) => {
                        if (!c) return html`<span class="w-7 h-7"></span>`;
                        const isSel = !!(sel && sel.getFullYear() === c.date.getFullYear() && sel.getMonth() === c.date.getMonth() && sel.getDate() === c.date.getDate());
                        return html`
                            <button
                                type="button"
                                class=${classMap({
                                    "w-7 h-7 rounded-md text-xs cursor-pointer border-none transition-colors": true,
                                    "bg-primary text-primary-foreground": isSel,
                                    "text-foreground hover:bg-muted": !isSel,
                                })}
                                @click=${() => this.pick(c.date)}
                            >${c.d}</button>
                        `;
                    })}
                </div>
            </div>
        `;
    }

    @ClientState() private viewYear: number = new Date().getFullYear();
    @ClientState() private viewMonth: number = new Date().getMonth();

    onMount() {
        if (this.props.value) {
            const [y, m] = this.props.value.split("-").map(Number);
            this.viewYear = y;
            this.viewMonth = m - 1;
        }
    }

    @Client()
    private prevMonth() {
        if (this.viewMonth === 0) { this.viewMonth = 11; this.viewYear -= 1; }
        else { this.viewMonth -= 1; }
    }

    @Client()
    private nextMonth() {
        if (this.viewMonth === 11) { this.viewMonth = 0; this.viewYear += 1; }
        else { this.viewMonth += 1; }
    }

    @Client()
    private pick(date: Date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        const iso = `${y}-${m}-${d}`;
        this.inner = iso;
        this.props.onChange?.(iso);
        this.hidePopover();
    }

    @Client()
    private togglePopover() {
        const el = document.getElementById(this.popoverId) as any;
        el?.togglePopover?.();
        requestAnimationFrame(() => this.position());
    }

    @Client()
    private hidePopover() {
        const el = document.getElementById(this.popoverId) as any;
        el?.hidePopover?.();
    }

    @Client()
    private onToggle(e: Event) {
        const el = e.target as HTMLElement;
        if (el.id === this.popoverId && el.matches(":popover-open")) {
            requestAnimationFrame(() => this.position());
        }
    }

    @Client()
    private position() {
        const trigger = this.inputRef.value;
        const popover = document.getElementById(this.popoverId);
        if (!trigger || !popover || !popover.matches(":popover-open")) return;
        const rect = trigger.getBoundingClientRect();
        popover.style.position = "fixed";
        popover.style.top = `${rect.bottom + 4}px`;
        popover.style.left = `${rect.left}px`;
        popover.style.margin = "0";
    }
}
