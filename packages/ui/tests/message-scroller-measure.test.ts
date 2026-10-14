// @vitest-environment jsdom
// Wheel, pointer, key and focus events arrive in bursts. Recording the reading
// position must not measure every row on every event.
import { afterEach, expect, it, vi } from 'vitest';
import { MessageScroller } from '../src/components/MessageScroller';

type Internals = {
    viewport?: HTMLDivElement; content?: HTMLDivElement; disposeObservers?: () => void;
    anchors: { element: Element; offset: number }[]; following: boolean; remember(): void; reconcile(): void;
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function transcript(rows: number, rowHeight = 20) {
    const viewport = document.createElement('div'), content = document.createElement('div');
    viewport.append(content); document.body.append(viewport);
    for (let index = 0; index < rows; index++) { const row = document.createElement('p'); row.dataset.index = String(index); content.append(row); }
    let scrollTop = 0;
    Object.defineProperty(viewport, 'clientHeight', { value: 200 });
    Object.defineProperty(viewport, 'scrollHeight', { value: rows * rowHeight });
    Object.defineProperty(viewport, 'scrollTop', { get: () => scrollTop, set: value => { scrollTop = value; } });
    viewport.scrollTo = ((options: ScrollToOptions) => { scrollTop = options.top ?? scrollTop; }) as typeof viewport.scrollTo;
    let measured = 0;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        if (this === viewport) return DOMRect.fromRect({ x: 0, y: 0, width: 300, height: 200 });
        measured++;
        const index = Number((this as HTMLElement).dataset.index);
        return DOMRect.fromRect({ x: 0, y: index * rowHeight - scrollTop, width: 300, height: rowHeight });
    });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const scroller = new MessageScroller();
    const internals = scroller as unknown as Internals;
    internals.viewport = viewport; internals.content = content; internals.disposeObservers = () => {};
    return {
        internals, setScroll: (value: number) => { scrollTop = value; }, measured: () => measured,
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
