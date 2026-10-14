// @vitest-environment jsdom
// Refs run before a client render adopts its cloned nodes, so the fieldset
// walk must wait until the control is in the document.
import { afterEach, expect, it, vi } from 'vitest';
import { component, html, render } from '@cossackframework/renderer';
import { Combobox } from '../src/components/Combobox';
import { Popover } from '../src/components/Popover';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

it.each([
    ['Combobox', () => component(Combobox, { id: 'fruit', 'aria-label': 'Fruit', options: [{ value: 'a', label: 'Apple' }] })],
    ['Popover', () => component(Popover, { id: 'info', trigger: 'Info' }, html`<p>Details</p>`)],
] as const)('%s observes its fieldset after a client mount', async (_name, control) => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const observed: Node[] = [];
    const observe = MutationObserver.prototype.observe;
    vi.spyOn(MutationObserver.prototype, 'observe').mockImplementation(function (this: MutationObserver, target: Node, options?: MutationObserverInit) {
        observed.push(target);
        return observe.call(this, target, options);
    });
    const container = document.createElement('div');
    document.body.append(container);
    render(html`<fieldset>${control()}</fieldset>`, container);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(observed).toContain(container.querySelector('fieldset'));
});
