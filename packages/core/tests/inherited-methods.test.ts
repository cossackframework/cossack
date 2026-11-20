// @vitest-environment jsdom
import 'reflect-metadata';
import { expect, it } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { State } from '../src/shared/decorators';
import { html } from '@cossackframework/renderer';

/** An application base class that pages extend, such as a shared workspace. */
abstract class Workspace extends Cossack {
    @State() rows: string[] = [];
    seenLoading: number | undefined;
    add(name: string) { this.rows = [...this.rows, name]; return this; }
    label() { return 'base'; }
    async init() { this.seenLoading = this.loading.init; }
}

class Studio extends Workspace {
    label() { return 'studio'; }
    render() { return html`<p>${this.rows.join(',')}</p>`; }
}

it('binds methods inherited from an application base class, the nearest definition winning', () => {
    const page = new Studio();
    const { add, label } = page;
    expect(add('a')).toBe(page);
    expect(page.rows).toEqual(['a']);
    expect(label()).toBe('studio');
    // Methods of Cossack itself stay on its prototype.
    expect(Object.hasOwn(page, 'requestUpdate')).toBe(false);
});

it('wraps an init() defined on the base class with the loading counter', async () => {
    const page = new Studio();
    await page.bootstrap({ skipInit: true });
    // bootstrap() wraps the hooks; the server calls init() through the wrapper.
    await page.init();
    expect(page.seenLoading).toBe(1);
    expect(page.loading.init).toBeUndefined();
});
