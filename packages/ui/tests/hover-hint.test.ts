// @vitest-environment jsdom
// Tooltips and hover cards act like popover="hint" in every browser: one open
// at a time, and no open delay while moving between triggers.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HoverController } from '../src/internal/hover';

const open = new WeakSet<Element>();
const matches = Element.prototype.matches;
beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    Object.assign(HTMLElement.prototype, {
        showPopover(this: HTMLElement) { open.add(this); },
        hidePopover(this: HTMLElement) { open.delete(this); },
    });
    Element.prototype.matches = function (this: Element, selector: string) {
        if (selector === ':popover-open') return open.has(this);
        return matches.call(this, selector);
    } as Element['matches'];
});
afterEach(() => {
    Element.prototype.matches = matches;
    vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren();
});

function hover(name: string, parent: Element = document.body) {
    const wrapper = document.createElement('span'), trigger = document.createElement('button'), panel = document.createElement('span');
    trigger.textContent = name; wrapper.append(trigger, panel); parent.append(wrapper);
    const controller = new HoverController(() => ({ openDelay: 300, closeDelay: 150 }));
    controller.attach(panel, wrapper);
    return { controller, wrapper, trigger, panel };
}
const enter = (element: Element) => element.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
const leave = (element: Element) => element.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));

it('closes a focused tooltip when another opens on hover', () => {
    const first = hover('First'), second = hover('Second');
    first.trigger.focus(); first.wrapper.dispatchEvent(new FocusEvent('focusin'));
    expect(open.has(first.panel)).toBe(true);
    enter(second.wrapper); vi.advanceTimersByTime(300);
    expect(open.has(second.panel)).toBe(true);
    expect(open.has(first.panel)).toBe(false);
    // Not a dismissal: interest in the first trigger opens it again.
    enter(first.wrapper);
    expect(open.has(first.panel)).toBe(true);
    expect(open.has(second.panel)).toBe(false);
    first.controller.disconnect(); second.controller.disconnect();
});

it('skips the open delay while other hover content is open', () => {
    const first = hover('First'), second = hover('Second');
    enter(first.wrapper);
    vi.advanceTimersByTime(299); expect(open.has(first.panel)).toBe(false);
    vi.advanceTimersByTime(1); expect(open.has(first.panel)).toBe(true);
    leave(first.wrapper); enter(second.wrapper);
    expect(open.has(second.panel)).toBe(true);
    expect(open.has(first.panel)).toBe(false);
    leave(second.wrapper); vi.advanceTimersByTime(150);
    expect(open.has(second.panel)).toBe(false);
    // Nothing is open now, so the delay applies again.
    enter(first.wrapper); vi.advanceTimersByTime(100);
    expect(open.has(first.panel)).toBe(false);
    first.controller.disconnect(); second.controller.disconnect();
});

it('keeps content that holds the trigger or keyboard focus open', () => {
    const card = hover('Card');
    const field = document.createElement('input'); card.panel.append(field);
    card.controller.show(true);
    const nested = hover('Nested', card.panel);
    nested.controller.show(true);
    expect(open.has(card.panel)).toBe(true);
    expect(open.has(nested.panel)).toBe(true);
    nested.controller.hide();
    field.focus();
    const other = hover('Other');
    other.controller.show(true);
    expect(open.has(other.panel)).toBe(true);
    expect(open.has(card.panel)).toBe(true);
    expect(document.activeElement).toBe(field);
    card.controller.disconnect(); nested.controller.disconnect(); other.controller.disconnect();
});
