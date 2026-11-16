import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactiveControllerHost } from '@cossackframework/renderer';
import { DisclosureController, disclosureStyle } from '../src/internal/disclosure';

function fixture(initialOpen = false) {
    let open = initialOpen;
    let height = 120;
    let displayedHeight = 45;
    const animations: Array<{ cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }> = [];
    const animate = vi.fn(() => {
        const animation = { cancel: vi.fn(), onfinish: null as (() => void) | null };
        animations.push(animation);
        return animation;
    });
    // The renderer sets the resting hidden attribute before the controller runs.
    const attributes = new Map<string, string>(initialOpen ? [] : [['hidden', 'until-found']]);
    const wrapper = {
        style: { height: '', overflow: '' },
        getBoundingClientRect: () => ({ height: displayedHeight }),
        getAttribute: (name: string) => attributes.get(name) ?? null,
        setAttribute: (name: string, value: string) => { attributes.set(name, value); },
        removeAttribute: (name: string) => { attributes.delete(name); },
        animate,
    } as unknown as HTMLElement;
    const content = { getBoundingClientRect: () => ({ height }) } as HTMLElement;
    const host = { addController: vi.fn() } as unknown as ReactiveControllerHost;
    const controller = new DisclosureController(host, () => ({ open, wrapper, content }));
    controller.hostUpdated();
    return {
        controller, wrapper, animate, animations, host, attributes,
        update(next: boolean, hidden: string | null = 'until-found') {
            open = next;
            if (next) attributes.delete('hidden'); else if (hidden !== null) attributes.set('hidden', hidden);
            controller.hostUpdated();
        },
        resize(next: number) { height = next; },
        display(next: number) { displayedHeight = next; },
    };
}

afterEach(() => vi.unstubAllGlobals());

describe('disclosure height animation', () => {
    it.each([false, true])('preserves SSR state on mount (open=%s)', (open) => {
        const f = fixture(open);
        expect(f.host.addController).toHaveBeenCalledWith(f.controller);
        expect(f.animate).not.toHaveBeenCalled();
        expect(disclosureStyle(open)).toBe(open
            ? 'height: auto; overflow: visible;'
            : 'height: 0; overflow: hidden;');
    });

    it('clips only during animation and releases the measured height when finished', () => {
        const f = fixture();
        f.update(true);
        expect(f.animate).toHaveBeenCalledWith([
            { height: '0px', overflow: 'hidden' },
            { height: '120px', overflow: 'hidden' },
        ], expect.objectContaining({ duration: 300 }));
        f.animations[0].onfinish!();
        expect(f.animations[0].cancel).toHaveBeenCalledOnce();
        expect(f.wrapper.style.overflow).toBe('visible');
        // Growing open content needs no new animation or persistent height clamp.
        f.resize(640);
        f.update(true);
        expect(f.animate).toHaveBeenCalledOnce();
        f.update(false);
        expect(f.animate).toHaveBeenLastCalledWith([
            { height: '640px', overflow: 'hidden' },
            { height: '0px', overflow: 'hidden' },
        ], expect.anything());
    });

    it('measures content that changes while closed on the next opening', () => {
        const f = fixture();
        f.resize(800);
        f.update(true);
        expect(f.animate.mock.calls[0]).toEqual([
            [{ height: '0px', overflow: 'hidden' }, { height: '800px', overflow: 'hidden' }],
            expect.anything(),
        ]);
    });

    it('reverses an interrupted animation from the current visible height', () => {
        const f = fixture();
        f.update(true);
        f.display(67);
        f.update(false);
        expect(f.animations[0].cancel).toHaveBeenCalledOnce();
        expect(f.animations[0].onfinish).toBeNull();
        expect(f.animate).toHaveBeenLastCalledWith([
            { height: '67px', overflow: 'hidden' },
            { height: '0px', overflow: 'hidden' },
        ], expect.anything());
        f.controller.hostDisconnected();
        expect(f.animations[1].cancel).toHaveBeenCalledOnce();
        expect(f.animations[1].onfinish).toBeNull();
    });

    it('respects reduced motion without waiting for an animation event', () => {
        vi.stubGlobal('matchMedia', () => ({ matches: true }));
        const f = fixture();
        f.update(true);
        expect(f.animate).not.toHaveBeenCalled();
        expect(f.wrapper.style.overflow).toBe('visible');
    });

    it('works without the Web Animations API', () => {
        const f = fixture();
        Object.defineProperty(f.wrapper, 'animate', { value: undefined });
        f.update(true);
        expect(f.wrapper.style.overflow).toBe('visible');
        f.update(false);
        expect(f.wrapper.style.overflow).toBe('hidden');
    });

    it('keeps the until-found attribute through mount', () => {
        const f = fixture();
        expect(f.attributes.get('hidden')).toBe('until-found');
        expect(f.wrapper.style.height).toBe('0');
    });

    it('keeps a collapsing panel painted and hides it again when the collapse ends', () => {
        const f = fixture(true);
        f.update(false);
        expect(f.attributes.has('hidden')).toBe(false);
        f.animations[0].onfinish!();
        expect(f.attributes.get('hidden')).toBe('until-found');
        f.update(true);
        f.update(false, '');
        f.animations.at(-1)!.onfinish!();
        expect(f.attributes.get('hidden')).toBe('');
    });

    it('does not hide a panel reopened during its collapse', () => {
        const f = fixture(true);
        f.update(false);
        f.update(true);
        expect(f.animations[0].onfinish).toBeNull();
        expect(f.attributes.has('hidden')).toBe(false);
    });

    it('shows a find-in-page reveal at rest and hides it again when the owner keeps it closed', () => {
        const f = fixture();
        f.attributes.delete('hidden');
        f.controller.revealed();
        expect(f.wrapper.style).toEqual({ height: 'auto', overflow: 'visible' });
        f.update(true);
        expect(f.animate).not.toHaveBeenCalled();
        // A controlled owner that refuses: the browser removed the attribute, the renderer will not set it again.
        const g = fixture();
        g.attributes.delete('hidden');
        g.controller.revealed();
        g.update(false, null);
        expect(g.attributes.has('hidden')).toBe(false);
        g.animations[0].onfinish!();
        expect(g.attributes.get('hidden')).toBe('until-found');
        expect(g.wrapper.style).toEqual({ height: '0', overflow: 'hidden' });
    });

    it('hides a closing panel at once under reduced motion', () => {
        vi.stubGlobal('matchMedia', () => ({ matches: true }));
        const f = fixture(true);
        f.update(false);
        expect(f.attributes.get('hidden')).toBe('until-found');
    });

    it('ignores task runs before refs are attached', () => {
        const host = { addController: vi.fn() } as unknown as ReactiveControllerHost;
        const controller = new DisclosureController(host, () => ({
            open: true, wrapper: undefined, content: undefined,
        }));
        expect(() => controller.hostUpdated()).not.toThrow();
        expect(() => controller.hostDisconnected()).not.toThrow();
    });
});
