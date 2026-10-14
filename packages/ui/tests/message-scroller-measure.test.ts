// @vitest-environment jsdom
// Wheel, pointer, key and focus events arrive in bursts. Recording the reading
// position must not measure every row on every event.
import { afterEach, expect, it, vi } from 'vitest';
import { MessageScroller } from '../src/components/MessageScroller';

type Internals = {
    viewport?: HTMLDivElement; content?: HTMLDivElement; disposeObservers?: () => void;
    anchors: { element: Element; offset: number }[]; following: boolean; remember(): void; reconcile(): void; geometryChanged(): void;
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function transcript(rows: number, rowHeight = 20) {
    const geometry = { rowHeight };
    const viewport = document.createElement('div'), content = document.createElement('div');
    viewport.append(content); document.body.append(viewport);
    for (let index = 0; index < rows; index++) { const row = document.createElement('p'); row.dataset.index = String(index); content.append(row); }
    let scrollTop = 0;
    Object.defineProperty(viewport, 'clientHeight', { value: 200 });
    Object.defineProperty(viewport, 'scrollHeight', { get: () => rows * geometry.rowHeight });
    Object.defineProperty(viewport, 'scrollTop', { get: () => scrollTop, set: value => { scrollTop = value; } });
    viewport.scrollTo = ((options: ScrollToOptions) => { scrollTop = options.top ?? scrollTop; }) as typeof viewport.scrollTo;
    let measured = 0;
    const perRow = new Map<string, number>();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        if (this === viewport) return DOMRect.fromRect({ x: 0, y: 0, width: 300, height: 200 });
        measured++;
        const index = (this as HTMLElement).dataset.index!;
        perRow.set(index, (perRow.get(index) ?? 0) + 1);
        return DOMRect.fromRect({ x: 0, y: Number(index) * geometry.rowHeight - scrollTop, width: 300, height: geometry.rowHeight });
    });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const scroller = new MessageScroller();
    const internals = scroller as unknown as Internals;
    internals.viewport = viewport; internals.content = content; internals.disposeObservers = () => {};
    return {
        internals, geometry, perRow, setScroll: (value: number) => { scrollTop = value; }, measured: () => measured,
        flush: () => { for (const frame of frames.splice(0)) frame(0); },
    };
}

it('measures once per frame and only rows near the viewport', () => {
    const { internals, setScroll, measured, flush } = transcript(1000);
    setScroll(8000);
    for (let event = 0; event < 20; event++) internals.remember();
    flush();
    expect(measured()).toBeLessThan(60);
    expect(internals.anchors.map(anchor => (anchor.element as HTMLElement).dataset.index)).toEqual(
        Array.from({ length: 10 }, (_, index) => String(400 + index)));
    expect(internals.anchors[0].offset).toBe(0);
});

it('keeps the reading position when content changes before a pending measurement', () => {
    const { internals, setScroll, flush } = transcript(100);
    internals.following = false;
    setScroll(400); internals.remember(); flush();
    // The reader scrolls; geometry changes before the next frame measures.
    setScroll(500); internals.remember();
    internals.reconcile();
    expect(internals.viewport!.scrollTop).toBe(500);
});

const visible = (internals: Internals) => internals.anchors.map(anchor => [(anchor.element as HTMLElement).dataset.index, anchor.offset]);

it('reuses row measurements while only the scroll position changes', () => {
    const { internals, setScroll, measured, perRow, flush } = transcript(1000);
    setScroll(8000); internals.remember(); flush();
    const first = measured();
    // Scrolling by two rows reads only the two rows that became visible.
    setScroll(8040); for (let event = 0; event < 5; event++) internals.remember(); flush();
    expect(measured() - first).toBe(2);
    expect(visible(internals)).toEqual(Array.from({ length: 10 }, (_, index) => [String(402 + index), index * 20]));
    // A partial-row scroll and a return over measured rows read nothing.
    const second = measured();
    setScroll(8050); internals.remember(); flush();
    expect(visible(internals)[0]).toEqual(['402', -10]);
    expect(visible(internals).at(-1)).toEqual(['412', 190]);
    setScroll(8000); internals.remember(); flush();
    expect(measured()).toBe(second + 1);
    expect(Math.max(...perRow.values())).toBe(1);
});

it('measures rows again after an observed geometry change or a reconcile', () => {
    const { internals, geometry, setScroll, measured, perRow, flush } = transcript(1000);
    internals.following = false;
    setScroll(8000); internals.remember(); flush();
    expect(perRow.get('400')).toBe(1);
    // Rows double in height and an observer reports it. The reconcile reads
    // fresh geometry and keeps the reader's first row at the top.
    geometry.rowHeight = 40;
    internals.geometryChanged(); flush();
    expect(internals.viewport!.scrollTop).toBe(16000);
    expect(visible(internals).slice(0, 2)).toEqual([['400', 0], ['401', 40]]);
    expect(perRow.get('400')).toBeGreaterThan(1);
    // A reconcile discards cached rows even before an observer reports a change.
    const settled = measured();
    internals.reconcile();
    expect(measured()).toBeGreaterThan(settled);
    // Without a change, scrolling back over those rows reads nothing new.
    const cached = measured();
    setScroll(16040); internals.remember(); flush();
    setScroll(16000); internals.remember(); flush();
    expect(measured() - cached).toBe(1);
});
