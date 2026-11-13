/**
 * The search box's browser part: suggestions while someone types. Up to five entries from the
 * site's search (`data-suggest`, `/api/cms/search`), whose last word is a prefix, in a listbox
 * under the box. The arrow keys move through them, Enter opens the one chosen, Escape closes the
 * list. Without this the form still submits to the search page.
 */
interface Suggestion { readonly title: string; readonly url: string }

const enhanced = new WeakSet<HTMLFormElement>();
let lists = 0;

export function enhanceSearch(form: HTMLFormElement): void {
    if (enhanced.has(form)) return;
    enhanced.add(form);
    const input = form.querySelector<HTMLInputElement>('input[name="q"]');
    const endpoint = form.dataset.suggest;
    if (!input || !endpoint) return;
    const id = `cms-search-suggestions-${++lists}`;
    const list = document.createElement('ul');
    list.id = id;
    list.className = 'cms-search-suggestions';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', form.dataset.suggestLabel || 'Suggestions');
    list.hidden = true;
    form.appendChild(list);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', id);
    input.setAttribute('aria-expanded', 'false');
    input.autocomplete = 'off';

    let shown: readonly Suggestion[] = [];
    let active = -1;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;

    const close = () => {
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        active = -1;
    };
    const choose = (index: number) => {
        active = index;
        list.querySelectorAll('[role="option"]').forEach((option, at) => option.setAttribute('aria-selected', at === index ? 'true' : 'false'));
        if (index < 0) input.removeAttribute('aria-activedescendant');
        else input.setAttribute('aria-activedescendant', `${id}-${index}`);
    };
    const show = (items: readonly Suggestion[]) => {
        shown = items;
        active = -1;
        list.replaceChildren(...items.map((item, index) => {
            const option = document.createElement('li');
            option.id = `${id}-${index}`;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', 'false');
            // A real link, so a middle click or a modifier opens a tab; focus stays in the box.
            const link = document.createElement('a');
            link.href = item.url;
            link.tabIndex = -1;
            link.textContent = item.title;
            option.appendChild(link);
            return option;
        }));
        if (!items.length) return close();
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        input.removeAttribute('aria-activedescendant');
    };
    const suggest = async (text: string) => {
        request?.abort();
        if (text.length < 2) return show([]);
        request = new AbortController();
        try {
            const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}q=${encodeURIComponent(text)}`;
            const response = await fetch(url, { headers: { accept: 'application/json' }, credentials: 'same-origin', signal: request.signal });
            if (!response.ok) return show([]);
            const body = await response.json() as { items?: { title?: unknown; url?: unknown }[] };
            // Only what is still typed is shown: a slower answer for older text never replaces it.
            if (input.value.trim() !== text) return;
            show((body.items ?? []).flatMap(item => typeof item.title === 'string' && typeof item.url === 'string' && item.url.startsWith('/') ? [{ title: item.title, url: item.url }] : []).slice(0, 5));
        } catch {
            /* aborted for newer text, or offline: the form still submits */
        }
    };

    input.addEventListener('input', () => {
        clearTimeout(timer);
        const text = input.value.trim();
        timer = setTimeout(() => void suggest(text), 150);
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !list.hidden) {
            event.preventDefault();
            close();
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (list.hidden || !shown.length) return;
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            choose(active < 0 ? (step > 0 ? 0 : shown.length - 1) : (active + step + shown.length) % shown.length);
            return;
        }
        if (event.key === 'Enter' && !list.hidden && active >= 0) {
            event.preventDefault();
            window.location.assign(shown[active]!.url);
        }
    });
    // Pressing an option must not blur the box first, or the list closes under the pointer.
    list.addEventListener('mousedown', event => event.preventDefault());
    form.addEventListener('focusout', event => {
        if (!form.contains(event.relatedTarget as Node | null)) close();
    });
    input.addEventListener('focus', () => { if (shown.length && input.value.trim().length >= 2) show(shown); });
}
