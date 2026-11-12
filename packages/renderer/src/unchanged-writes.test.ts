import { describe, expect, it } from 'vitest';
import { html, hydrate, nothing, render, renderToString, unsafeHTML } from './cossack-html';
import { ifDefined } from './directives';

/** The mutation records a render of the container queues. */
async function mutations(container: Element, run: () => void): Promise<MutationRecord[]> {
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(list => records.push(...list));
    observer.observe(container, { attributes: true, childList: true, subtree: true, characterData: true });
    run();
    await Promise.resolve();
    records.push(...observer.takeRecords());
    observer.disconnect();
    return records;
}

// A parent re-renders every child on each change: values that did not change
// must not reach the DOM, where each write queues a mutation and restyles.
describe('re-rendering unchanged values', () => {
    it('keeps the nodes of the same unsafeHTML string, such as an icon re-rendered with its parent', async () => {
        const container = document.createElement('div');
        const template = (raw: string, label: string) => html`<svg>${unsafeHTML(raw)}</svg><span>${label}</span>`;
        render(template('<path d="M0 0h10v10z"/>', 'a'), container);
        const path = container.querySelector('path');
        expect(await mutations(container, () => render(template('<path d="M0 0h10v10z"/>', 'b'), container))).toHaveLength(1);
        expect(container.querySelector('path')).toBe(path);
        render(template('<circle r="4"/>', 'b'), container);
        expect(container.querySelector('path')).toBeNull();
        expect(container.querySelector('circle')).not.toBeNull();
    });

    it('parses the string again after another value replaced it', () => {
        const container = document.createElement('div');
        const template = (value: unknown) => html`<div>${value}</div>`;
        render(template(unsafeHTML('<b>bold</b>')), container);
        render(template('text'), container);
        render(template(unsafeHTML('<b>bold</b>')), container);
        expect(container.querySelector('div')!.innerHTML.replace(/<!--.*?-->/g, '')).toBe('<b>bold</b>');
        render(template(html`<i>template</i>`), container);
        render(template(unsafeHTML('<b>bold</b>')), container);
        expect(container.querySelector('b')).not.toBeNull();
        expect(container.querySelector('i')).toBeNull();
    });

    it('keeps hydrated unsafeHTML nodes on the next render of the same string', async () => {
        const container = document.createElement('div');
        const template = () => html`<svg>${unsafeHTML('<path d="M0 0h10v10z"/>')}</svg>`;
        container.innerHTML = renderToString(template(), { hydrate: true });
        hydrate(template(), container);
        const path = container.querySelector('path');
        expect(await mutations(container, () => render(template(), container))).toEqual([]);
        expect(container.querySelector('path')).toBe(path);
    });

    it('writes an attribute only when its value changes', async () => {
        const container = document.createElement('div');
        const template = (title: string, disabled: boolean, label: string | undefined, hidden: unknown) =>
            html`<button title=${title} ?disabled=${disabled} aria-label=${ifDefined(label)} data-hidden=${hidden}>Go</button>`;
        render(template('Save', true, 'Save it', 'no'), container);
        expect(await mutations(container, () => render(template('Save', true, 'Save it', 'no'), container))).toEqual([]);
        const changed = await mutations(container, () => render(template('Send', false, undefined, nothing), container));
        expect(changed.map(record => record.attributeName).sort()).toEqual(['aria-label', 'data-hidden', 'disabled', 'title']);
        const button = container.querySelector('button')!;
        expect([button.title, button.disabled, button.hasAttribute('aria-label'), button.hasAttribute('data-hidden')]).toEqual(['Send', false, false, false]);
        expect(await mutations(container, () => render(template('Send', false, undefined, nothing), container))).toEqual([]);
        render(template('Save', true, 'Save it', 'no'), container);
        expect([button.title, button.disabled, button.getAttribute('aria-label'), button.getAttribute('data-hidden')]).toEqual(['Save', true, 'Save it', 'no']);
    });

    it('puts back an attribute that other code changed, on the next render of the same value', async () => {
        const container = document.createElement('div');
        const template = (expanded: string, disabled: boolean) => html`<button aria-expanded=${expanded} ?disabled=${disabled}>Go</button>`;
        render(template('false', true), container);
        const button = container.querySelector('button')!;
        // A component toggles the attributes itself; the parent renders its own values again.
        button.setAttribute('aria-expanded', 'true');
        button.removeAttribute('disabled');
        render(template('false', true), container);
        expect([button.getAttribute('aria-expanded'), button.disabled]).toEqual(['false', true]);
        expect(await mutations(container, () => render(template('false', true), container))).toEqual([]);
    });

    it('writes spread attributes and classes only when they change, and gives a dropped key back to the template', async () => {
        const container = document.createElement('div');
        const template = (props: Record<string, unknown>) => html`<div class="own" title="static" ...=${props}></div>`;
        render(template({ class: 'extra', title: 'spread', 'aria-hidden': 'true', '?inert': true }), container);
        const div = container.querySelector('div')!;
        expect(await mutations(container, () => render(template({ class: 'extra', title: 'spread', 'aria-hidden': 'true', '?inert': true }), container))).toEqual([]);
        expect([div.className, div.title, div.getAttribute('aria-hidden'), div.hasAttribute('inert')]).toEqual(['own extra', 'spread', 'true', true]);
        render(template({ class: 'other', 'aria-hidden': 'false', '?inert': false }), container);
        expect([div.className, div.title, div.getAttribute('aria-hidden'), div.hasAttribute('inert')]).toEqual(['own other', 'static', 'false', false]);
        // The template's value came back: a spread setting the same text again must write it.
        render(template({ class: 'other', title: 'static' }), container);
        expect(div.title).toBe('static');
        render(template({ class: 'other', title: 'spread' }), container);
        expect(div.title).toBe('spread');
    });

    it('keeps spread classes through a rewrite of the bound class attribute', async () => {
        const container = document.createElement('div');
        const template = (own: string) => html`<div class=${own} ...=${{ class: 'extra' }}></div>`;
        render(template('a'), container);
        const div = container.querySelector('div')!;
        expect(await mutations(container, () => render(template('a'), container))).toEqual([]);
        render(template('b'), container);
        expect(div.className.split(' ').sort()).toEqual(['b', 'extra']);
    });

    it('writes a spread attribute again after a bound attribute of the same name changed it', () => {
        const container = document.createElement('div');
        const template = (title: string) => html`<div title=${title} ...=${{ title: 'override' }}></div>`;
        render(template('a'), container);
        const div = container.querySelector('div')!;
        expect(div.title).toBe('override');
        render(template('b'), container);
        expect(div.title).toBe('override');
        expect(renderToString(template('b'))).toContain('title="override"');
    });
});
