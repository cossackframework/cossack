import { PreventDefaultResult, preventDefault, type nothing } from '@cossackframework/renderer';
import type { GlobalAttributes, ControlEvent } from '../native-attributes';

/** Attributes and events belong to the native dialog. Modal state belongs to the controller. */
export type DialogControlProps = Omit<GlobalAttributes<HTMLDialogElement>, 'role' | 'aria-modal' | 'tabindex'> & {
    /** Controlled state. Accept onOpenChange(false) by setting this false, or the dialog reopens. */
    open?: boolean;
    /** Initial uncontrolled state. SSR dialogs stay closed until client connection. */
    defaultOpen?: boolean;
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
    /** Proposes closing after a user/native dismissal, with the native close event. Prop-driven closing and cleanup do not call this. */
    onOpenChange?: (open: boolean, event: ControlEvent<HTMLDialogElement>) => unknown;
};
type Listener<E extends Event> = ((event: E) => unknown) | PreventDefaultResult | null | typeof nothing | undefined;
function invoke<E extends Event>(listener: Listener<E>, event: E) {
    if (typeof listener === 'function') listener(event);
    else if (listener instanceof PreventDefaultResult) listener.handler.call(event.currentTarget, event);
}
function compose<E extends Event>(own: (event: E) => void, supplied: Listener<E>) {
    const listener: EventListener = event => { invoke(supplied, event as E); if (!event.defaultPrevented) own(event as E); };
    return supplied instanceof PreventDefaultResult ? preventDefault(listener, { novalidate: supplied.novalidate }) : listener;
}

/** Native top-layer and focus behavior shared by Modal, Sheet and Drawer. */
export class DialogController {
    private element?: HTMLDialogElement;
    private initialOpen?: boolean;
    private localOpen?: boolean;
    private programmaticCloses = 0;
    private generation = 0;
    private pointerOutside = false;
    constructor(private read: () => DialogControlProps, private update: () => Promise<unknown>) {}

    connect(element: HTMLDialogElement) {
        if (this.element !== element) { this.disconnect(); this.element = element; }
        this.initialOpen ??= !!this.read().defaultOpen;
        const generation = this.generation;
        queueMicrotask(() => { if (generation === this.generation && element === this.element) this.sync(); });
    }
    private sync() {
        const element = this.element;
        if (!element?.isConnected) return;
        const wanted = this.read().open ?? this.localOpen ?? this.initialOpen ?? false;
        if (wanted && !element.matches(':modal')) {
            if (element.open) { this.programmaticCloses++; element.close(); }
            element.returnValue = '';
            element.showModal();
        } else if (!wanted && element.open) {
            this.programmaticCloses++;
            element.close();
        }
    }
    /** Explicit dismissal, including Drawer close controls. */
    close() { if (this.element?.open) this.element.close(); }
    private outside(event: MouseEvent) {
        const element = this.element, panel = element?.querySelector<HTMLElement>('[data-dialog-panel]');
        if (!element || !panel || event.target !== element) return false;
        const bounds = panel.getBoundingClientRect();
        return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    }
    events() {
        const props = this.read();
        const nativeClose = props['@close'];
        const closed: EventListener = event => {
            const element = event.currentTarget as HTMLDialogElement;
            if (element !== this.element) return;
            const controlledClose = this.programmaticCloses > 0;
            if (controlledClose) this.programmaticCloses--;
            // A queued close from an older session must not close a newly reopened dialog.
            const stale = element.open;
            if (!stale) this.localOpen = false;
            const generation = this.generation;
            try {
                if (!controlledClose && !stale) this.read().onOpenChange?.(false, event as ControlEvent<HTMLDialogElement>);
            } finally {
                try { invoke(nativeClose, event as ControlEvent<HTMLDialogElement>); }
                finally {
                    void this.update().then(() => { if (generation === this.generation && this.element === element) this.sync(); });
                }
            }
        };
        return {
            '@close': nativeClose instanceof PreventDefaultResult ? preventDefault(closed, { novalidate: nativeClose.novalidate }) : closed,
            '@cancel': compose<ControlEvent<HTMLDialogElement>>(event => { if (this.read().closeOnEscape === false) event.preventDefault(); }, props['@cancel']),
            '@pointerdown': compose<ControlEvent<HTMLDialogElement, PointerEvent>>(event => { this.pointerOutside = event.button === 0 && this.outside(event); }, props['@pointerdown']),
            '@click': compose<ControlEvent<HTMLDialogElement, PointerEvent>>(event => {
                const outside = this.pointerOutside;
                this.pointerOutside = false;
                if (event.detail > 0 && outside && this.read().closeOnBackdrop !== false && this.outside(event)) this.close();
            }, props['@click']),
        };
    }
    disconnect() {
        const element = this.element;
        this.element = undefined;
        this.generation++;
        this.programmaticCloses = 0;
        this.pointerOutside = false;
        if (element?.open) element.close();
    }
}
