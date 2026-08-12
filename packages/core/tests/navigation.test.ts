// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    applyNavigationScroll,
    createNavigationHistoryState,
    getSavedScrollPosition,
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

    it('scrolls new navigation to the top by default', () => {
        applyNavigationScroll('/next', 'auto', 'push');

        expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 0, behavior: 'instant' });
    });

    it('scrolls a new fragment navigation to its rendered target', () => {
        const target = document.createElement('section');
        target.id = 'details';
        target.scrollIntoView = vi.fn();
        document.body.appendChild(target);

        applyNavigationScroll('/next#details', 'auto', 'push');

        expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
        expect(scrollTo).not.toHaveBeenCalled();
    });

    it('restores the destination history entry during traversal', () => {
        window.history.replaceState(
            { __cossackNavigation: { scroll: { x: 12, y: 900 } } },
            '',
            '/previous',
        );

        applyNavigationScroll('/previous', 'auto', 'traverse');

        expect(scrollTo).toHaveBeenCalledWith({ left: 12, top: 900, behavior: 'instant' });
    });

    it('does not move the viewport when preserve is requested', () => {
        applyNavigationScroll('/next', 'preserve', 'push');

        expect(scrollTo).not.toHaveBeenCalled();
    });
});
