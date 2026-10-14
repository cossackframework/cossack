// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableClientNavigation } from '../src/client/navigation';

describe('client link interception', () => {
    let disable: () => void;
    const onNavigate = vi.fn(async () => true);
    const onPreFetch = vi.fn(async () => {});

    beforeEach(() => {
        vi.useFakeTimers();
        onNavigate.mockClear();
        onPreFetch.mockClear();
        disable = enableClientNavigation(onNavigate, onPreFetch);
    });

    afterEach(() => {
        disable();
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    const link = (href: string) => {
        const anchor = document.createElement('a');
        anchor.setAttribute('href', href);
        anchor.textContent = href;
        document.body.append(anchor);
        return anchor;
    };
    const click = (anchor: HTMLAnchorElement) => {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
        anchor.dispatchEvent(event);
        return event;
    };

    it.each(['mailto:a@example.com', 'tel:+15551234', 'javascript:void(0)', 'sms:+1555', 'https://other.example/x', '//other.example/x'])(
        'leaves %s to the browser',
        (href) => {
            const event = click(link(href));
            expect(event.defaultPrevented).toBe(false);
            expect(onNavigate).not.toHaveBeenCalled();
        },
    );

    it.each(['mailto:a@example.com', 'tel:+15551234', 'javascript:void(0)'])('does not prefetch %s', (href) => {
        link(href).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        vi.advanceTimersByTime(100);
        expect(onPreFetch).not.toHaveBeenCalled();
    });

    it('intercepts same-origin relative links', () => {
        const event = click(link('/about?tab=1'));
        expect(event.defaultPrevented).toBe(true);
        expect(onNavigate).toHaveBeenCalledWith('/about?tab=1', undefined);
    });

    it('intercepts same-origin absolute http(s) links as SPA routes', () => {
        const event = click(link(`${window.location.origin}/docs#intro`));
        expect(event.defaultPrevented).toBe(true);
        expect(onNavigate).toHaveBeenCalledWith('/docs#intro', undefined);
    });

    it('prefetches same-origin links', () => {
        link('/about').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        vi.advanceTimersByTime(100);
        expect(onPreFetch).toHaveBeenCalledWith('/about');
    });
});
