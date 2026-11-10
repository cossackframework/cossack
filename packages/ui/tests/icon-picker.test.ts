// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { component, render, renderToString } from '@cossackframework/renderer';
import { IconPicker } from '../src/components/IconPicker';
import type { IconEntry } from '@cossackframework/solar-icons/types';

const ICONS: Record<string, IconEntry> = {
    'star': { line: '<path d="M1 1" />' },
    'star-fall': { line: '<path d="M2 2" />' },
    'heart': { line: '<path d="M3 3" />' },
};

// jsdom has no ResizeObserver; the popover watches its trigger with one.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

afterEach(() => { document.body.replaceChildren(); });

it('renders the chosen icon on the trigger and a searchable grid', async () => {
    const html = renderToString(component(IconPicker, { id: 'pick', value: 'heart', icons: ICONS }));
    expect(html).toContain('M3 3');
    expect(html).toContain('heart');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('title="star-fall"');
    expect(html).toContain('None');
});

it('filters by name and reports a pick', async () => {
    const picked: string[] = [];
    const host = document.createElement('div');
    document.body.append(host);
    render(component(IconPicker, { id: 'pick', value: '', icons: ICONS, onChange: (name: string) => picked.push(name) }), host);
    await new Promise(resolve => setTimeout(resolve, 30));
    const search = host.querySelector('input[type=search]') as HTMLInputElement;
    search.value = 'star fall';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect([...host.querySelectorAll('[role=option]')].map(option => option.getAttribute('title'))).toEqual(['star-fall']);
    (host.querySelector('[role=option]') as HTMLButtonElement).click();
    expect(picked).toEqual(['star-fall']);
});

it('loads a larger set the first time the picker opens', async () => {
    let loads = 0;
    const host = document.createElement('div');
    document.body.append(host);
    render(component(IconPicker, { id: 'pick', value: 'star', icons: async () => { loads++; return ICONS; } }), host);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(host.textContent).toContain('Loading icons');
    expect(loads).toBe(0);
    const content = host.querySelector('#pick-picker-content')!;
    content.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'open' }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(loads).toBe(1);
    expect(host.querySelectorAll('[role=option]').length).toBe(4);
    expect(host.querySelector('.cs-icon-picker')?.innerHTML).toContain('M1 1');
});

it('browses a catalog by category, searches across all of them and keeps the icons picked last', async () => {
    localStorage.removeItem('cs-icon-picker-recent');
    const picked: string[] = [];
    const catalog = {
        categories: [
            { id: 'arrows', label: 'Arrows', names: ['arrow-up', 'arrow-down'] },
            { id: 'space', label: 'Astronomy', names: ['asteroid', 'star'] },
        ],
        entry: (name: string) => ({ line: `<path d="${name}" />` }),
    };
    const host = document.createElement('div');
    document.body.append(host);
    render(component(IconPicker, { id: 'pick', value: '', icons: catalog, onChange: (name: string) => picked.push(name) }), host);
    await new Promise(resolve => setTimeout(resolve, 30));
    host.querySelector('#pick-picker-content')!.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'open' }));
    await new Promise(resolve => setTimeout(resolve, 20));
    const options = () => [...host.querySelectorAll('[role=option]')].map(option => option.getAttribute('title'));
    const tabs = () => [...host.querySelectorAll('[role=tab]')].map(tab => `${tab.getAttribute('title')}${tab.getAttribute('aria-selected') === 'true' ? '*' : ''}`);
    // No recent picks yet: the first category opens, with None first.
    expect(tabs()).toEqual(['Arrows*', 'Astronomy']);
    expect(options()).toEqual(['None', 'arrow-up', 'arrow-down']);
    (host.querySelectorAll('[role=tab]')[1] as HTMLButtonElement).click();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(tabs()).toEqual(['Arrows', 'Astronomy*']);
    expect(options()).toEqual(['None', 'asteroid', 'star']);
    // A search looks across every category and hides the tabs.
    const search = host.querySelector('input[type=search]') as HTMLInputElement;
    search.value = 'ar';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(host.querySelector('[role=tablist]')).toBeNull();
    expect(options()).toEqual(['arrow-up', 'arrow-down', 'star']);
    (host.querySelectorAll('[role=option]')[2] as HTMLButtonElement).click();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(picked).toEqual(['star']);
    expect(JSON.parse(localStorage.getItem('cs-icon-picker-recent')!)).toEqual(['star']);
    // The next open starts on Recent.
    host.querySelector('#pick-picker-content')!.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'open' }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(tabs()[0]).toBe('Recent*');
    expect(options()).toEqual(['star']);
});
