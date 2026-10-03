// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    applyNavigationScroll,
    createNavigationHistoryState,
    getSavedScrollPosition,
    getNavigationHistoryLocation,
    navigationHistoryStateAt,
    saveCurrentScrollPosition,
} from '../src/client/navigation';

describe('SPA navigation scroll behavior', () => {
    const scrollTo = vi.fn();

    beforeEach(() => {
        scrollTo.mockReset();
        vi.stubGlobal('scrollTo', scrollTo);
        Object.defineProperty(window, 'scrollX', { configurable: true, value: 24 });
        Object.defineProperty(window, 'scrollY', { configurable: true, value: 480 });
        window.history.replaceState({ app: 'state' }, '', '/current');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('saves the current position without discarding existing history state', () => {
        saveCurrentScrollPosition();

        expect(window.history.state.app).toBe('state');
        expect(getSavedScrollPosition(window.history.state)).toEqual({ x: 24, y: 480 });
    });

    it('creates scroll state for a newly pushed entry', () => {
        expect(getSavedScrollPosition(createNavigationHistoryState())).toEqual({ x: 24, y: 480 });
    });

    it('keeps owned history positions, scroll and application fields through updates', () => {
        const original = { application: 'kept', __cossackNavigation: { scroll: { x: 1, y: 2 }, custom: 'kept' } };
        const location = { group: 'this-app', position: 3 };
        const updated = navigationHistoryStateAt(original, location);
        expect(getNavigationHistoryLocation(updated)).toEqual(location);
        expect(updated).toMatchObject({ application: 'kept', __cossackNavigation: { custom: 'kept' } });
        expect(getSavedScrollPosition(updated)).toEqual({ x: 1, y: 2 });
        expect(original.__cossackNavigation).not.toHaveProperty('location');
        location.position = 4; expect(getNavigationHistoryLocation(updated)?.position).toBe(3);
        window.history.replaceState(updated, '', '/current'); saveCurrentScrollPosition();
        expect(getNavigationHistoryLocation(window.history.state)?.position).toBe(3);
    });

    it.each([null, {}, { group: '', position: 1 }, { group: 'app', position: -1 },
        { group: 'app', position: 1.5 }, { group: 'app', position: Infinity },
        { group: 'app', position: Number.MAX_SAFE_INTEGER + 1 }])('does not invent positions for invalid or foreign entries (%#)', location => {
        expect(getNavigationHistoryLocation({ __cossackNavigation: { location } })).toBeUndefined();
    });

    it('scrolls new navigation to the top by default', () => {
        expect(applyNavigationScroll('/next', 'auto', 'push')).toBe('top');

        expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 0, behavior: 'instant' });
    });

    it('scrolls a new fragment navigation to its rendered target', () => {
        const target = document.createElement('section');
        target.id = 'details';
        target.scrollIntoView = vi.fn();
        document.body.appendChild(target);

        expect(applyNavigationScroll('/next#details', 'auto', 'push')).toBe('fragment');

        expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
        expect(scrollTo).not.toHaveBeenCalled();
    });

    it('restores the destination history entry during traversal', () => {
        window.history.replaceState(
            { __cossackNavigation: { scroll: { x: 12, y: 900 } } },
            '',
            '/previous',
        );

        expect(applyNavigationScroll('/previous', 'auto', 'traverse')).toBe('history');

        expect(scrollTo).toHaveBeenCalledWith({ left: 12, top: 900, behavior: 'instant' });
    });

    it('reports explicit top scrolling even when a fragment exists', () => {
        expect(applyNavigationScroll('/next#details', 'top', 'traverse')).toBe('top');
        expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 0, behavior: 'instant' });
    });

    it('reports unavailable scrolling without a browser', () => {
        vi.stubGlobal('window', undefined);
        expect(applyNavigationScroll('/next', 'auto', 'push')).toBe('unavailable');
        expect(scrollTo).not.toHaveBeenCalled();
    });

    it('reports a missing fragment while scrolling to the top', () => {
        expect(applyNavigationScroll('/next#missing', 'auto', 'push')).toBe('fragment-missing');
        expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 0, behavior: 'instant' });
    });

    it('does not move the viewport when preserve is requested', () => {
        expect(applyNavigationScroll('/next', 'preserve', 'push')).toBe('preserve');

        expect(scrollTo).not.toHaveBeenCalled();
    });
});
