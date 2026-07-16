import { html, classMap, component } from "@cossackframework/renderer";
import { Cossack, Component, Client, ClientState } from "@cossackframework/core";
import { Icon } from "../icons/Icon";
import { AltArrowLeftIcon as altArrowLeftIcon } from "@cossackframework/solar-icons/alt-arrow-left";
import { AltArrowRightIcon as altArrowRightIcon } from "@cossackframework/solar-icons/alt-arrow-right";

export interface CalendarProps {
    /** Selected date (ISO yyyy-mm-dd). */
    value?: string;
    /** Earliest selectable date (ISO). */
    min?: string;
    /** Latest selectable date (ISO). */
    max?: string;
    /** Called when a date is selected. */
    onChange?: (iso: string) => void;
    [key: string]: any;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

/** Parse an ISO date (yyyy-mm-dd) into local Date at midnight. */
function parseISO(iso?: string): Date | null {
    if (!iso) return null;
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
}

/** Format a Date to ISO yyyy-mm-dd (local). */
function toISO(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

/** True if two dates are the same calendar day. */
function isSameDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

/**
 * Cossack UI Calendar — month-grid date picker.
 *
 * A pure-CSS grid (no external date library). Renders one month at a time with
 * prev/next navigation. Supports `value`, `min`, `max` range bounds, and a
 * `onChange` callback that fires an ISO `yyyy-mm-dd` string.
 *
 *   ${component(Calendar, {
 *       value: this.startDate,
 *       onChange: (iso) => { this.startDate = iso; },
 *   })}
 */
@Component()
export class Calendar extends Cossack {
    declare props: CalendarProps;

    /** The currently-viewed month (1st of that month). */
    @ClientState() private viewYear: number = new Date().getFullYear();
    @ClientState() private viewMonth: number = new Date().getMonth();

    render() {
        const selected = parseISO(this.props.value);
        const min = parseISO(this.props.min);
        const max = parseISO(this.props.max);

        const firstOfMonth = new Date(this.viewYear, this.viewMonth, 1);
        const startWeekday = firstOfMonth.getDay();
        const daysInMonth = new Date(this.viewYear, this.viewMonth + 1, 0).getDate();

        // Leading blanks for the grid (Su-first week).
        const cells: Array<{ day: number; date: Date } | null> = [];
        for (let i = 0; i < startWeekday; i++) cells.push(null);
        for (let d = 1; d <= daysInMonth; d++) {
            cells.push({ day: d, date: new Date(this.viewYear, this.viewMonth, d) });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return html`
            <div class="cs-calendar inline-block rounded-lg border bg-popover text-popover-foreground p-3 select-none">
                <div class="cs-calendar__header flex items-center justify-between mb-3">
                    <button
                        type="button"
                        class="cs-calendar__prev inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer border-none bg-transparent"
                        aria-label="Previous month"
                        @click=${() => this.prevMonth()}
                    >
                        <span class="inline-flex items-center justify-center [&_svg]:size-4">${component(Icon, { entry: altArrowLeftIcon, size: 16 })}</span>
                    </button>
                    <span class="cs-calendar__title text-sm font-medium text-foreground">
                        ${MONTHS[this.viewMonth]} ${this.viewYear}
                    </span>
                    <button
                        type="button"
                        class="cs-calendar__next inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer border-none bg-transparent"
                        aria-label="Next month"
                        @click=${() => this.nextMonth()}
                    >
                        <span class="inline-flex items-center justify-center [&_svg]:size-4">${component(Icon, { entry: altArrowRightIcon, size: 16 })}</span>
                    </button>
                </div>
                <div class="cs-calendar__weekdays grid grid-cols-7 gap-1 mb-1">
                    ${WEEKDAYS.map((d) => html`
                        <span class="text-xs font-medium text-muted-foreground text-center w-8 h-8 flex items-center justify-center">${d}</span>
                    `)}
                </div>
                <div class="cs-calendar__grid grid grid-cols-7 gap-1">
                    ${cells.map((cell) => {
                        if (!cell) return html`<span class="w-8 h-8"></span>`;
                        const isSelected = !!(selected && isSameDay(cell.date, selected));
                        const isToday = isSameDay(cell.date, today);
                        const isDisabled = !!(
                            (min && cell.date < min) || (max && cell.date > max)
                        );
                        return html`
                            <button
                                type="button"
                                class=${classMap({
                                    "cs-calendar__day": true,
                                    "w-8 h-8 rounded-md text-sm cursor-pointer border-none transition-colors": true,
                                    "bg-primary text-primary-foreground": !!isSelected,
                                    "bg-accent text-accent-foreground": !isSelected && isToday,
                                    "hover:bg-accent hover:text-accent-foreground": !isSelected && !isToday && !isDisabled,
                                    "text-muted-foreground/40 cursor-not-allowed": isDisabled,
                                })}
                                ?disabled=${!!isDisabled}
                                @click=${() => this.selectDay(cell.date)}
                            >${cell.day}</button>
                        `;
                    })}
                </div>
            </div>
        `;
    }

    onMount() {
        // Initialize the view month to the selected date if provided.
        const sel = parseISO(this.props.value);
        if (sel) {
            this.viewYear = sel.getFullYear();
            this.viewMonth = sel.getMonth();
        }
    }

    @Client()
    private prevMonth() {
        if (this.viewMonth === 0) {
            this.viewMonth = 11;
            this.viewYear -= 1;
        } else {
            this.viewMonth -= 1;
        }
    }

    @Client()
    private nextMonth() {
        if (this.viewMonth === 11) {
            this.viewMonth = 0;
            this.viewYear += 1;
        } else {
            this.viewMonth += 1;
        }
    }

    @Client()
    private selectDay(date: Date) {
        const iso = toISO(date);
        this.props.onChange?.(iso);
    }
}
