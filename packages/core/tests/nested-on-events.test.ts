// @vitest-environment jsdom
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { component, html, render } from '@cossackframework/renderer';
import { Cossack } from '../src/shared/cossack';
import { On } from '../src/shared/decorators';

const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('@On on component() children', () => {
    const clicks: string[] = [];
    class Item extends Cossack {
        declare props: { name: string };
        @On('click')
        handleClick(event: Event) {
            clicks.push(`${this.props.name}:${(event.target as Element).id}`);
        }
        render() {
            return html`<button id=${`btn-${this.props.name}`}><span id=${`label-${this.props.name}`}>${this.props.name}</span></button>`;
        }
    }

    const mount = async () => {
        clicks.length = 0;
        const container = document.createElement('div');
        document.body.appendChild(container);
        render(html`<section><p id="outside">x</p>${component(Item, { name: 'a' })}${component(Item, { name: 'b' })}</section>`, container);
        await flush();
        return container;
    };
    const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    it('fires for clicks inside the child range only', async () => {
        const container = await mount();
        click(container.querySelector('#label-a')!);
        expect(clicks).toEqual(['a:label-a']);
        click(container.querySelector('#btn-b')!);
        expect(clicks).toEqual(['a:label-a', 'b:btn-b']);
        click(container.querySelector('#outside')!);
        click(document.body);
        expect(clicks).toEqual(['a:label-a', 'b:btn-b']);
        container.remove();
    });

    it('does not attach nested @On handlers to the document', async () => {
        const container = await mount();
        const stray = document.createElement('div');
        stray.id = 'stray';
        document.body.appendChild(stray);
        click(stray);
        expect(clicks).toEqual([]);
        stray.remove();
        container.remove();
    });

    it('removes the listener when the child is torn down', async () => {
        clicks.length = 0;
        const container = document.createElement('div');
        document.body.appendChild(container);
        const page = (show: boolean) => html`<section>${show ? component(Item, { name: 'a' }) : null}</section>`;
        render(page(true), container);
        await flush();
        const section = container.querySelector('section')!;
        const button = container.querySelector('#btn-a')!;
        click(button);
        expect(clicks).toEqual(['a:btn-a']);
        render(page(false), container);
        await flush();
        expect(container.querySelector('section')).toBe(section);
        // Put the old node back under the same parent: no listener may still
        // be delegating for the destroyed child.
        section.appendChild(button);
        click(button);
        expect(clicks).toEqual(['a:btn-a']);
        container.remove();
    });
});

describe('@On on bootstrapped page components', () => {
    it('keeps document delegation for a page without a container', async () => {
        let clicks = 0;
        class Page extends Cossack {
            protected override isServer = false;
            @On('click')
            onClick() { clicks++; }
            render() { return html`<p>page</p>`; }
        }
        const page = new Page();
        await page.bootstrap({ initialState: { public: {}, private: {}, metadata: {} } as any });
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(clicks).toBe(1);
        await page.destroy();
    });
});
