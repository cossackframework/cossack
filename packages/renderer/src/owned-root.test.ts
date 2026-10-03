import { expect, it } from 'vitest';
import { CossackElement } from './cossack-element';
import { html } from './cossack-html';

it('attaches roots without publishing and prevents old or detached roots from overwriting the active DOM', async () => {
    class Root extends CossackElement {
        text = '';
        render() { return html`<p>${this.text}</p>`; }
    }
    const container = document.createElement('div');
    container.textContent = 'server';
    const first = new Root(); const second = new Root();
    let current = first;
    const detachFirst = first._frameworkAttachRenderRoot(container, () => current === first);
    second._frameworkAttachRenderRoot(container, () => current === second);
    expect(container.textContent).toBe('server');
    first.text = 'first'; await first.requestUpdate();
    expect(container.textContent).toBe('first');
    first.text = 'stale'; const pending = first.requestUpdate();
    current = second;
    await pending;
    expect(container.textContent).toBe('first');
    second.text = 'second'; await second.requestUpdate();
    expect(container.textContent).toBe('second');
    // Rollback can reuse the original listener while its owner remains alive.
    current = first; first.text = 'restored'; await first.requestUpdate();
    expect(container.textContent).toBe('restored');
    detachFirst(); first.text = 'detached'; await first.requestUpdate();
    expect(container.textContent).toBe('restored');
});


it('clears the previous owner DOM when the active root renders null', async () => {
    class PrivateRoot extends CossackElement {
        render() { return html`<p>private content</p>`; }
    }
    const container = document.createElement('div');
    const first = new PrivateRoot();
    const empty = new CossackElement();
    let current: CossackElement = first;
    first._frameworkAttachRenderRoot(container, () => current === first);
    empty._frameworkAttachRenderRoot(container, () => current === empty);
    await first.requestUpdate();
    expect(container.textContent).toBe('private content');
    current = empty;
    await empty.requestUpdate();
    expect(container.textContent).toBe('');
    await first.requestUpdate();
    expect(container.textContent).toBe('');
});
