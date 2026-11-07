/**
 * The browser's part of a countdown block: the units tick every second until the moment, then
 * the block shows what it was told to show after. The server wrote the first values.
 */
const enhanced = new WeakSet<HTMLElement>();

/** Days, hours, minutes and seconds between two moments; null once `until` has passed. */
export function remaining(until: number, now: number): { days: number; hours: number; minutes: number; seconds: number } | null {
    const left = Math.floor((until - now) / 1000);
    if (left <= 0) return null;
    return { days: Math.floor(left / 86_400), hours: Math.floor((left % 86_400) / 3600), minutes: Math.floor((left % 3600) / 60), seconds: left % 60 };
}

export function enhanceCountdown(root: HTMLElement): void {
    if (enhanced.has(root)) return;
    enhanced.add(root);
    const until = Number(root.dataset.until);
    if (!Number.isFinite(until)) return;
    const values = [...root.querySelectorAll<HTMLElement>('.cms-countdown-value')];
    const units = root.querySelector<HTMLElement>('.cms-countdown-units');
    const done = root.querySelector<HTMLElement>('.cms-countdown-done');
    const tick = () => {
        const left = remaining(until, Date.now());
        if (!left) {
            if (units) units.hidden = true;
            if (done) done.hidden = false;
            clearInterval(timer);
            return;
        }
        for (const value of values) {
            const unit = value.dataset.unit as 'days' | 'hours' | 'minutes' | 'seconds' | undefined;
            if (unit && unit in left) value.textContent = unit === 'days' ? String(left[unit]) : String(left[unit]).padStart(2, '0');
        }
    };
    const timer = setInterval(() => { if (!root.isConnected) clearInterval(timer); else tick(); }, 1000);
    tick();
}
