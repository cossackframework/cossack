// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('__', (value: string) => value);
const { searchForm } = await import('../src/cms/site-view');
const { enhanceSearch } = await import('../src/cms/search.client');
const { renderToString } = await import('@cossackframework/renderer/server');

const answer = (titles: string[]) => new Response(JSON.stringify({ items: titles.map((title, index) => ({ title, url: `/posts/${index}`, collection: 'posts', id: String(index), snippet: [] })), page: 1, next: false, loose: false }), { headers: { 'content-type': 'application/json' } });

/** The form in the document, enhanced, with its box and a way to type into it. */
async function box(locale = 'en') {
    document.body.innerHTML = await renderToString(searchForm('/search', {}, locale));
    const form = document.querySelector<HTMLFormElement>('form.cms-search')!;
    enhanceSearch(form);
    const input = form.querySelector<HTMLInputElement>('input[name="q"]')!;
    const type = async (text: string) => {
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(200);
    };
    const key = (name: string) => {
        const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
        input.dispatchEvent(event);
        return event;
    };
    return { form, input, type, key, list: () => form.querySelector<HTMLUListElement>('[role="listbox"]')! };
}

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.stubGlobal('__', (value: string) => value);
});

describe('search box suggestions', () => {
    it('asks the site search of the page language, unless turned off', async () => {
        const on = await renderToString(searchForm('/vi/search', {}, 'vi'));
        expect(on).toMatch(/data-suggest="\/api\/cms\/search\?perPage=5(?:&amp;|&)locale=vi"/);
        expect(on).toContain('data-suggest-label="Suggestions"');
        expect(await renderToString(searchForm('/search', { suggest: false }, 'en'))).not.toContain('data-suggest');
    });

    it('lists entries while someone types, from two characters, and opens the one chosen with the keyboard', async () => {
        vi.useFakeTimers();
        const fetch = vi.fn(async () => answer(['Walrus facts', 'Walrus notes']));
        vi.stubGlobal('fetch', fetch);
        const { input, type, key, list } = await box();
        expect(input.getAttribute('role')).toBe('combobox');
        expect(input.getAttribute('aria-expanded')).toBe('false');
        await type('w');
        expect(fetch).not.toHaveBeenCalled();
        await type('walr');
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe('/api/cms/search?perPage=5&locale=en&q=walr');
        expect(list().hidden).toBe(false);
        expect(input.getAttribute('aria-expanded')).toBe('true');
        expect([...list().querySelectorAll('[role="option"] a')].map(link => [link.textContent, link.getAttribute('href')])).toEqual([['Walrus facts', '/posts/0'], ['Walrus notes', '/posts/1']]);
        key('ArrowDown');
        key('ArrowDown');
        expect(input.getAttribute('aria-activedescendant')).toBe(list().querySelectorAll('[role="option"]')[1]!.id);
        expect(list().querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
        key('ArrowDown');
        expect(input.getAttribute('aria-activedescendant')).toBe(list().querySelectorAll('[role="option"]')[0]!.id);
        const assign = vi.fn();
        vi.stubGlobal('location', { ...window.location, assign });
        expect(key('Enter').defaultPrevented).toBe(true);
        expect(assign).toHaveBeenCalledWith('/posts/0');
        expect(key('Escape').defaultPrevented).toBe(true);
        expect(list().hidden).toBe(true);
        expect(input.hasAttribute('aria-activedescendant')).toBe(false);
        // A closed list leaves Escape and Enter to the box: Enter submits the search.
        expect(key('Escape').defaultPrevented).toBe(false);
        expect(key('Enter').defaultPrevented).toBe(false);
    });

    it('shows only what is still typed, and nothing for an empty answer', async () => {
        vi.useFakeTimers();
        let release!: (response: Response) => void;
        const slow = new Promise<Response>(resolve => { release = resolve; });
        const fetch = vi.fn().mockReturnValueOnce(slow).mockResolvedValueOnce(answer([]));
        vi.stubGlobal('fetch', fetch);
        const { type, list } = await box();
        await type('wal');
        await type('walrus pelican');
        release(answer(['Walrus facts']));
        await vi.advanceTimersByTimeAsync(10);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(list().hidden).toBe(true);
        expect(list().children).toHaveLength(0);
    });
});
