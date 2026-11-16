/**
 * The browser's part of a stat block: the number counts up from zero when the block scrolls
 * into view, in the digits and separators it was written with ("1,250", "4.9", "12 000").
 * Reduced motion, or a browser without observers, shows the number as it is.
 */
const enhanced = new WeakSet<HTMLElement>();

/** The parts of a written number: its digits, the grouping separator, and the decimal separator with its digits. */
export function parseStat(value: string): { target: number; group: string; decimal: string; decimals: number } | null {
    const text = value.trim();
    if (!/^[0-9][0-9., ]*$/.test(text)) return null;
    const separators = [...text.matchAll(/[., ]/g)].map(match => ({ char: match[0], at: match.index! }));
    const last = separators.at(-1);
    // The last separator is the decimal point when what follows it is not a group of three digits.
    const decimal = last && last.char !== ' ' && text.length - last.at - 1 !== 3 ? last.char : '';
    const integerPart = decimal ? text.slice(0, last!.at) : text;
    const fraction = decimal ? text.slice(last!.at + 1).replace(/\D/g, '') : '';
    const group = separators.find(separator => separator.char !== decimal || !decimal)?.char ?? '';
    const digits = integerPart.replace(/\D/g, '');
    const target = Number(`${digits || '0'}.${fraction || '0'}`);
    return Number.isFinite(target) ? { target, group: decimal && group === decimal ? '' : group, decimal, decimals: fraction.length } : null;
}

/** A number written like the original: grouped by threes with its separator, and its decimals. */
export function formatStat(value: number, shape: { group: string; decimal: string; decimals: number }): string {
    const [whole, fraction = ''] = value.toFixed(shape.decimals).split('.');
    const grouped = shape.group ? whole!.replace(/\B(?=(\d{3})+(?!\d))/g, shape.group) : whole!;
    return shape.decimals ? `${grouped}${shape.decimal || '.'}${fraction}` : grouped;
}

export function enhanceStat(root: HTMLElement): void {
    if (enhanced.has(root)) return;
    enhanced.add(root);
    const number = root.querySelector<HTMLElement>('.cms-stat-number');
    const shape = number ? parseStat(number.dataset.value ?? number.textContent ?? '') : null;
    if (!number || !shape || root.dataset.animate !== 'true' || typeof IntersectionObserver === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const written = number.textContent ?? '';
    const duration = 1400;
    const run = () => {
        const start = performance.now();
        const frame = (now: number) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            number.textContent = progress < 1 ? formatStat(shape.target * eased, shape) : written;
            if (progress < 1) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    };
    number.textContent = formatStat(0, shape);
    const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        run();
    }, { threshold: 0.3 });
    observer.observe(root);
}
