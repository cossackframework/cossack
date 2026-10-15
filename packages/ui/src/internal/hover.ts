export type HoverSettings = {
    /** Milliseconds from pointer hover to opening. Focus opens immediately. Default 300. */
    openDelay?: number;
    /** Milliseconds from leaving the trigger and panel to closing. Default 150. */
    closeDelay?: number;
    disabled?: boolean;
    side?: 'top' | 'bottom' | 'left' | 'right';
};
export function validateHover(id: string, settings: HoverSettings) {
    if (typeof id !== 'string' || !id || /\s/.test(id)) throw new Error('Hover content requires a nonempty, whitespace-free id.');
    for (const [name, value] of [['openDelay', settings.openDelay], ['closeDelay', settings.closeDelay]] as const) {
        if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 60000)) throw new RangeError(`${name} must be an integer from 0 to 60000 milliseconds.`);
    }
    if (settings.side !== undefined && !['top','bottom','left','right'].includes(settings.side)) throw new Error('side must be top, bottom, left or right.');
}
/** Hover/focus ownership for a manual popover. No extra focusable wrapper is created. */
export class HoverController {
    private wrapper?: HTMLElement;
    private panel?: HTMLElement;
    private cleanup?: () => void;
    private timer?: ReturnType<typeof setTimeout>;
    private generation = 0;
    private opening = false;
    private overTrigger = false;
    private overPanel = false;
    private dismissed = false;
    private returnTo?: HTMLElement;
    constructor(private read: () => HoverSettings) {}
    private focused() { return !!this.wrapper?.contains(this.wrapper.ownerDocument.activeElement); }
    private clear() { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; this.opening = false; }
    private interested() { return this.overTrigger || this.overPanel || this.focused(); }
    private reconcile(immediate = false) {
        this.clear();
        if (this.read().disabled) { this.hide(); return; }
        if (!this.interested()) {
            this.dismissed = false;
            if (this.panel?.matches(':popover-open')) this.timer = setTimeout(() => { this.timer = undefined; if (!this.interested()) this.hide(false); }, this.read().closeDelay ?? 150);
        } else if (!this.dismissed) {
            if (immediate || this.focused()) this.show();
            else { this.opening = true; this.timer = setTimeout(() => { this.timer = undefined; this.opening = false; if (this.interested() && !this.dismissed) this.show(); }, this.read().openDelay ?? 300); }
        }
    }
    attach(panel: HTMLElement, wrapper: HTMLElement) {
        if (!panel.isConnected || !wrapper.isConnected) {
            const generation = this.generation;
            queueMicrotask(() => { if (generation === this.generation && panel.isConnected && wrapper.isConnected) this.attach(panel, wrapper); });
            return;
        }
        if (this.panel !== panel || this.wrapper !== wrapper) {
            this.disconnect(); this.panel = panel; this.wrapper = wrapper;
            const document = panel.ownerDocument, window = document.defaultView;
            const enter = (event: PointerEvent) => { if (event.pointerType === 'touch' || event.defaultPrevented) return; this.overTrigger = true; this.reconcile(); };
            const leave = () => { this.overTrigger = false; this.reconcile(); };
            const enterPanel = () => { this.overPanel = true; this.reconcile(true); };
            const leavePanel = () => { this.overPanel = false; this.reconcile(); };
            const focus = () => this.reconcile(true);
            const blur = () => { const generation = this.generation; queueMicrotask(() => { if (generation === this.generation) this.reconcile(); }); };
            const escape = (event: KeyboardEvent) => {
                if (event.key !== 'Escape' || event.defaultPrevented || (!panel.matches(':popover-open') && !this.opening)) return;
                // A tooltip left behind the active modal must not consume the
                // Escape intended for that modal's native dismissal.
                const modal = document.activeElement?.closest('dialog:modal');
                if (modal && !modal.contains(wrapper) && !modal.contains(panel)) { this.hide(); return; }
                event.preventDefault(); this.hide();
            };
            const outside = (event: PointerEvent) => { if (!wrapper.contains(event.target as Node) && !panel.contains(event.target as Node)) this.hide(); };
            const position = () => this.position();
            wrapper.addEventListener('pointerenter', enter); wrapper.addEventListener('pointerleave', leave);
            wrapper.addEventListener('focusin', focus); wrapper.addEventListener('focusout', blur);
            panel.addEventListener('pointerenter', enterPanel); panel.addEventListener('pointerleave', leavePanel);
            document.addEventListener('keydown', escape); document.addEventListener('pointerdown', outside);
            document.addEventListener('scroll', position, true); window?.addEventListener('resize', position);
            window?.visualViewport?.addEventListener('resize', position); window?.visualViewport?.addEventListener('scroll', position);
            const resize = new ResizeObserver(position); resize.observe(panel); resize.observe(wrapper);
            this.cleanup = () => {
                wrapper.removeEventListener('pointerenter', enter); wrapper.removeEventListener('pointerleave', leave);
                wrapper.removeEventListener('focusin', focus); wrapper.removeEventListener('focusout', blur);
                panel.removeEventListener('pointerenter', enterPanel); panel.removeEventListener('pointerleave', leavePanel);
                document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside);
                document.removeEventListener('scroll', position, true); window?.removeEventListener('resize', position);
                window?.visualViewport?.removeEventListener('resize', position); window?.visualViewport?.removeEventListener('scroll', position);
                resize.disconnect();
                if (panel.matches(':popover-open')) panel.hidePopover();
            };
            // Hydration can attach while a child already holds keyboard focus.
            if (this.focused()) this.reconcile(true);
        }
        const generation = this.generation;
        queueMicrotask(() => {
            if (generation !== this.generation || this.panel !== panel || !panel.isConnected) return;
            if (this.read().disabled) this.hide(); else this.position();
        });
    }
    show(force = false) {
        if (force) this.dismissed = false;
        const panel = this.panel, wrapper = this.wrapper;
        if (!panel?.isConnected || !wrapper?.isConnected || this.read().disabled || this.dismissed) return;
        this.clear();
        const previous = panel.ownerDocument.activeElement;
        if (previous instanceof HTMLElement && wrapper.contains(previous) && !panel.contains(previous)) this.returnTo = previous;
        else if (!this.returnTo?.isConnected || !wrapper.contains(this.returnTo)) {
            this.returnTo = Array.from(wrapper.querySelectorAll<HTMLElement>('button,a[href],input,textarea,select,[tabindex]')).find(element => !panel.contains(element) && !element.matches(':disabled,[hidden],[inert]'));
        }
        if (!panel.matches(':popover-open')) panel.showPopover();
        // Passive hover/focus content must not steal focus through descendant autofocus.
        if (previous instanceof HTMLElement && panel.contains(panel.ownerDocument.activeElement) && !panel.contains(previous)) {
            if (previous === panel.ownerDocument.body) (panel.ownerDocument.activeElement as HTMLElement).blur();
            else previous.focus({ preventScroll: true });
        }
        this.position();
    }
    hide(dismiss = true) {
        this.clear();
        if (dismiss) this.dismissed = this.interested();
        const ownsFocus = !!this.panel?.contains(this.panel.ownerDocument.activeElement);
        if (this.panel?.isConnected && this.panel.matches(':popover-open')) this.panel.hidePopover();
        if (dismiss && ownsFocus && this.returnTo?.isConnected) this.returnTo.focus({ preventScroll: true });
    }
    private position() {
        const panel = this.panel, wrapper = this.wrapper, window = panel?.ownerDocument.defaultView;
        if (!panel?.isConnected || !wrapper?.isConnected || !window || !panel.matches(':popover-open')) return;
        const viewport = window.visualViewport, gap = 6, x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
        const vw = viewport?.width ?? window.innerWidth, vh = viewport?.height ?? window.innerHeight;
        Object.assign(panel.style, { position: 'fixed', margin: '0', inset: 'auto', boxSizing: 'border-box', maxWidth: `${Math.max(0,vw-gap*2)}px`, maxHeight: `${Math.max(0,vh-gap*2)}px`, overflow: 'auto' });
        const rect = wrapper.getBoundingClientRect(), width = panel.offsetWidth, height = panel.offsetHeight;
        let side = this.read().side ?? 'top';
        const room = { top: rect.top-y-gap, bottom: y+vh-rect.bottom-gap, left: rect.left-x-gap, right: x+vw-rect.right-gap };
        const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const;
        if (room[side] < (side === 'top' || side === 'bottom' ? height : width) && room[opposite[side]] > room[side]) side = opposite[side];
        const horizontal = side === 'top' || side === 'bottom';
        const left = horizontal ? rect.left+(rect.width-width)/2 : side === 'left' ? rect.left-width-gap : rect.right+gap;
        const top = horizontal ? side === 'top' ? rect.top-height-gap : rect.bottom+gap : rect.top+(rect.height-height)/2;
        panel.style.left = `${Math.max(x+gap,Math.min(left,x+vw-width-gap))}px`;
        panel.style.top = `${Math.max(y+gap,Math.min(top,y+vh-height-gap))}px`;
        panel.dataset.side = side;
    }
    disconnect() {
        this.generation++; this.clear(); this.cleanup?.(); this.cleanup = undefined;
        this.panel = undefined; this.wrapper = undefined; this.overTrigger = false; this.overPanel = false; this.dismissed = false; this.returnTo = undefined;
    }
}
