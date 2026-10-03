import { describe, expect, it } from 'vitest';
import { CossackElement } from './cossack-element';
import { captureRenderDrafts, html, render } from './cossack-html';
import { cache, key, repeat } from './directives';
import type { ComponentResult } from './component';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function fixture() {
    const instances: Draft[] = [];
    const capabilities = new WeakMap<object, { clazz: Function; text: string }>();
    class Draft extends CossackElement {
        text = '';
        destroyed = false;
        scope: unknown;
        _setServiceScope(scope: unknown) { this.scope = scope; }
        _getServiceScope() { return this.scope; }
        static _frameworkForkClientDraft(token: object) {
            const draft = capabilities.get(token);
            if (!draft || draft.clazz !== this) return undefined;
            const fork = {}; capabilities.set(fork, { ...draft }); return fork;
        }
        _frameworkCaptureClientDraft() {
            if (this.destroyed) throw new Error('read destroyed owner');
            const token = {}; capabilities.set(token, { clazz: this.constructor, text: this.text }); return token;
        }
        _frameworkRestoreClientDraft(token: object) {
            const draft = capabilities.get(token);
            if (!draft || draft.clazz !== this.constructor) return false;
            capabilities.delete(token); this.text = draft.text; return true;
        }
        connectedCallback() { instances.push(this); super.connectedCallback(); }
        destroy() { this.destroyed = true; }
        render() { return html`<span>${this.text}</span>`; }
    }
    const scope = {};
    const parent = new CossackElement();
    const child = (clazz = Draft, owner = parent, serviceScope = scope): ComponentResult => ({
        _type: 'COMPONENT', clazz, parent: owner, serviceScope, props: {}, children: undefined,
    });
    const template = (value: unknown) => html`<main>${value}</main>`;
    const container = document.createElement('div');
    return { instances, Draft, scope, parent, child, template, container };
}

describe('local renderer draft checkpoints', () => {
    it.each(['scope', 'parent', 'class', 'key', 'revocation', 'discard', 'plain-value'])('rejects hidden recovery after %s changes', async mode => {
        const f = fixture();
        const branch = (clazz = f.Draft, parent = f.parent, scope = f.scope) => html`${f.child(clazz, parent, scope)}`;
        let ownerKey = 'old';
        const view = (value: unknown) => f.template(key(ownerKey, html`${cache(value)}`));
        render(view(branch()), f.container); await settle();
        f.instances[0].text = 'hidden private draft';
        render(view(null), f.container);
        const snapshot = captureRenderDrafts(f.container);
        render(html`elsewhere`, f.container);
        let current = true;
        snapshot.restore(() => current);
        render(view(null), f.container);
        if (mode === 'key') ownerKey = 'new';
        if (mode === 'revocation') current = false;
        if (mode === 'discard') snapshot.discard();
        if (mode === 'plain-value') render(f.template('uncached'), f.container);
        class Other extends f.Draft {}
        render(view(branch(mode === 'class' ? Other : f.Draft,
            mode === 'parent' ? new CossackElement() : f.parent,
            mode === 'scope' ? {} : f.scope)), f.container);
        await settle();
        expect(f.instances.at(-1)!.text).toBe('');
    });

    it('restores branches hidden by cache(null) and keeps checkpoints independent', async () => {
        const f = fixture();
        const branch = () => html`${f.child()}`;
        const view = (visible: boolean) => f.template(cache(visible ? branch() : null));
        render(view(true), f.container); await settle();
        f.instances[0].text = 'hidden';
        render(view(false), f.container);
        const first = captureRenderDrafts(f.container);
        render(html`elsewhere`, f.container);
        first.restore(() => true);
        render(view(false), f.container);
        const second = captureRenderDrafts(f.container);
        render(html`elsewhere again`, f.container);
        second.restore(() => true);
        render(view(false), f.container);
        render(view(true), f.container); await settle();
        expect(f.instances.at(-1)!.text).toBe('hidden');
    });

    it('preserves hidden branches through two owner replacements with independent rollback capabilities', async () => {
        const f = fixture();
        const a = (parent: CossackElement) => html`<section>${f.child(f.Draft, parent)}</section>`;
        const b = (parent: CossackElement) => html`<aside>${f.child(f.Draft, parent)}</aside>`;
        const hidden = () => html`<p>hidden</p>`;
        const view = (branch: unknown) => f.template(cache(branch));
        render(view(a(f.parent)), f.container); await settle();
        f.instances[0].text = 'A';
        render(view(b(f.parent)), f.container); await settle();
        f.instances[1].text = 'B';
        render(view(hidden()), f.container);
        let generation = 0;
        const first = captureRenderDrafts(f.container);
        const secondOwner = new CossackElement();
        generation = 1;
        first.restore(() => generation === 1, [[f.parent, secondOwner]]);
        render(view(hidden()), f.container);
        expect(f.instances.every(instance => instance.destroyed)).toBe(true);
        // A later snapshot must fork remaining capabilities, never read the
        // disposed owners or share a token between destination and rollback.
        const rollback = captureRenderDrafts(f.container);
        const forward = captureRenderDrafts(f.container);
        const thirdOwner = new CossackElement();
        generation = 2;
        forward.restore(() => generation === 2, [[secondOwner, thirdOwner]]);
        render(view(hidden()), f.container);
        render(view(a(thirdOwner)), f.container); await settle();
        expect(f.instances.at(-1)!.text).toBe('A');
        f.instances.at(-1)!.text = 'destination edit';
        render(html`failed destination`, f.container);
        generation = 1;
        rollback.restore(() => generation === 1);
        render(view(hidden()), f.container);
        render(view(b(secondOwner)), f.container); await settle();
        expect(f.instances.at(-1)!.text).toBe('B');
        render(view(a(secondOwner)), f.container); await settle();
        expect(f.instances.at(-1)!.text).toBe('A');
    });

    it('restores nested drafts into fresh matching owners before their first render', async () => {
        const f = fixture();
        class Parent extends f.Draft {
            render() { return html`<section>${this.text}${f.child(f.Draft, this)}</section>`; }
        }
        const template = () => f.template(f.child(Parent));
        render(template(), f.container); await settle();
        const [oldParent, oldChild] = f.instances;
        oldParent.text = 'outer'; oldChild.text = 'inner';
        const snapshot = captureRenderDrafts(f.container);
        render(html`other page`, f.container);
        expect(oldParent.destroyed && oldChild.destroyed).toBe(true);
        snapshot.restore(() => true);
        render(template(), f.container); await settle();
        expect(f.instances.slice(2).map(instance => instance.text)).toEqual(['outer', 'inner']);
        expect(f.container.textContent).toBe('outerinner');
        expect(f.instances[2]).not.toBe(oldParent);
        expect(f.instances[3]).not.toBe(oldChild);
    });

    it.each(['class', 'parent', 'scope', 'key', 'revoked'])('does not restore a draft after %s changes', async mode => {
        const f = fixture();
        render(f.template(key('old', f.child())), f.container); await settle();
        f.instances[0].text = 'private draft';
        const snapshot = captureRenderDrafts(f.container);
        render(html`other page`, f.container);
        class Other extends f.Draft {}
        snapshot.restore(() => mode !== 'revoked');
        render(f.template(key(mode === 'key' ? 'new' : 'old', f.child(
            mode === 'class' ? Other : f.Draft,
            mode === 'parent' ? new CossackElement() : f.parent,
            mode === 'scope' ? {} : f.scope,
        ))), f.container);
        await settle();
        expect(f.instances.at(-1)!.text).toBe('');
    });

    it('matches reordered repeated children by key and supports an explicit replacement page owner', async () => {
        const f = fixture();
        const list = (ids: string[], parent = f.parent) => f.template(repeat(ids, id => id, () => f.child(f.Draft, parent)));
        render(list(['a', 'b']), f.container); await settle();
        f.instances[0].text = 'a draft'; f.instances[1].text = 'b draft';
        const snapshot = captureRenderDrafts(f.container);
        render(html`other`, f.container);
        const nextParent = new CossackElement();
        snapshot.restore(() => true, [[f.parent, nextParent]]);
        render(list(['b', 'a'], nextParent), f.container); await settle();
        expect(f.instances.slice(2).map(instance => instance.text)).toEqual(['b draft', 'a draft']);
    });

    it('does not overwrite a retained live component and discards unused checkpoints', async () => {
        const f = fixture();
        render(f.template(f.child()), f.container); await settle();
        f.instances[0].text = 'before';
        const snapshot = captureRenderDrafts(f.container);
        f.instances[0].text = 'after';
        snapshot.restore(() => true);
        render(f.template(f.child()), f.container); await settle();
        expect(f.instances).toHaveLength(1);
        expect(f.instances[0].text).toBe('after');
        const discarded = captureRenderDrafts(f.container);
        discarded.restore(() => true); discarded.discard();
        render(html`other`, f.container);
        render(f.template(f.child()), f.container); await settle();
        expect(f.instances[1].text).toBe('');
    });

    it('restores positional arrays and the active cached template without serializing drafts', async () => {
        const f = fixture();
        const content = () => html`${[f.child(), f.child()]}`;
        const template = () => f.template(cache(content()));
        render(template(), f.container); await settle();
        f.instances[0].text = 'first'; f.instances[1].text = 'second';
        const snapshot = captureRenderDrafts(f.container);
        render(html`elsewhere`, f.container);
        snapshot.restore(() => true);
        render(template(), f.container); await settle();
        expect(f.instances.slice(2).map(instance => instance.text)).toEqual(['first', 'second']);
    });

    it('revokes a pending descendant restore before its first render callback', async () => {
        const f = fixture();
        class Parent extends f.Draft {
            render() { return html`${f.child(f.Draft, this)}`; }
        }
        const template = () => f.template(f.child(Parent));
        render(template(), f.container); await settle();
        f.instances[1].text = 'old private value';
        const snapshot = captureRenderDrafts(f.container);
        render(html`elsewhere`, f.container);
        let current = true;
        snapshot.restore(() => current);
        render(template(), f.container);
        current = false;
        await settle();
        expect(f.instances.at(-1)!.text).toBe('');
    });

    it('cleans new repeated siblings when a later item fails during reconciliation', async () => {
        const f = fixture();
        class Failing extends f.Draft {
            connectedCallback() { super.connectedCallback(); throw new Error('broken repeat'); }
        }
        expect(() => render(f.template(repeat([false, true], item => item,
            failing => f.child(failing ? Failing : f.Draft))), f.container)).toThrow('broken repeat');
        expect(f.instances).toHaveLength(2);
        expect(f.instances.every(instance => instance.destroyed)).toBe(true);
    });

    it('does not leak recovery through a mismatched wrapper that renders synchronously during connection', async () => {
        const f = fixture();
        const slot = () => {
            const template = html`${f.child()}`;
            (template as any).__cossackOwner = f.parent;
            return template;
        };
        class Wrapper extends f.Draft {
            render() { return slot(); }
            connectedCallback() {
                super.connectedCallback();
                (this as any).__notifyListeners(this.render());
            }
        }
        class DifferentWrapper extends Wrapper {}
        render(f.template(f.child(Wrapper)), f.container); await settle();
        f.instances[1].text = 'private child';
        const snapshot = captureRenderDrafts(f.container);
        render(html`elsewhere`, f.container);
        snapshot.restore(() => true);
        render(f.template(f.child(DifferentWrapper)), f.container); await settle();
        expect(f.instances.at(-1)!.text).toBe('');
    });
});
