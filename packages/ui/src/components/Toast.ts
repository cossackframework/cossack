import { html, component, repeat } from '@cossackframework/renderer';
import { Cossack, Component, ClientState } from '@cossackframework/core';
import { Icon } from '../icons/Icon';
import { CloseCircleIcon } from '@cossackframework/solar-icons/close-circle';
import { InfoCircleIcon } from '@cossackframework/solar-icons/info-circle';
import { CheckCircleIcon } from '@cossackframework/solar-icons/check-circle';
import { DangerTriangleIcon } from '@cossackframework/solar-icons/danger-triangle';
import { DangerCircleIcon } from '@cossackframework/solar-icons/danger-circle';
import type { IconEntry } from '@cossackframework/solar-icons/types';
import type { GlobalAttributes } from '../native-attributes';

export type ToastVariant = 'default' | 'success' | 'warning' | 'destructive';
export interface ToastOptions {
    variant?: ToastVariant;
    /** Active presenter milliseconds before dismissal. Zero stays until explicitly dismissed. */
    duration?: number;
}
export interface ToastItem {
    readonly id: string;
    readonly message: string;
    readonly variant: ToastVariant;
    readonly duration: number;
}
export interface ToastStore {
    get(): readonly ToastItem[];
    subscribe(listener: (items: readonly ToastItem[]) => void): () => void;
    show(message: string, options?: ToastOptions): string;
    success(message: string, options?: Omit<ToastOptions, 'variant'>): string;
    warning(message: string, options?: Omit<ToastOptions, 'variant'>): string;
    error(message: string, options?: Omit<ToastOptions, 'variant'>): string;
    dismiss(id: string): void;
    clear(): void;
    /** Permanently release this store. Do not dispose the shared default store. */
    dispose(): void;
}
export interface ToastStoreOptions {
    /** Most toasts kept at once. Showing another drops the oldest. Default 5. */
    maxToasts?: number;
}
interface ToastPresenter { pause(reason: string, paused: boolean): void; release(): void; }
const presenters = new WeakMap<ToastStore, () => ToastPresenter>();
let nextToastId = 0;
const variants: readonly string[] = ['default', 'success', 'warning', 'destructive'];
function requireBrowser() {
    if (typeof window === 'undefined' || typeof document === 'undefined') throw new Error('Toast writes and subscriptions require a browser. Return server results to a client handler first.');
}

/** Create an isolated browser notification queue. It owns no timers until a Toaster mounts. */
export function createToastStore({ maxToasts = 5 }: ToastStoreOptions = {}): ToastStore {
    if (!Number.isInteger(maxToasts) || maxToasts < 1 || maxToasts > 100) throw new Error('Toast maxToasts must be an integer from 1 to 100.');
    let items: readonly ToastItem[] = Object.freeze([]), disposed = false, mounted = false;
    const listeners = new Set<(items: readonly ToastItem[]) => void>();
    const clocks = new Map<string, { remaining: number; started: number; timer?: ReturnType<typeof setTimeout> }>();
    const pauses = new Set<string>();
    const check = () => { requireBrowser(); if (disposed) throw new Error('Toast store is disposed.'); };
    const notify = () => {
        const failures: unknown[] = [];
        for (const listener of [...listeners]) { try { listener(items); } catch (error) { failures.push(error); } }
        if (failures.length) throw new AggregateError(failures, 'Toast subscriber failed.');
    };
    const cancel = (id: string) => { const clock = clocks.get(id); if (clock?.timer !== undefined) clearTimeout(clock.timer); clocks.delete(id); };
    const schedule = () => {
        if (!mounted || pauses.size) return;
        for (const [id, clock] of clocks) if (clock.timer === undefined) {
            clock.started = performance.now();
            clock.timer = setTimeout(() => store.dismiss(id), clock.remaining);
        }
    };
    const clear = () => { for (const id of clocks.keys()) cancel(id); items = Object.freeze([]); notify(); };
    const show = (message: string, options: ToastOptions = {}) => {
        check();
        if (typeof message !== 'string' || !message.trim()) throw new Error('Toast requires a nonempty message.');
        if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'duration' && key !== 'variant')) throw new Error('Toast options accept only duration and variant.');
        const { duration = 4000, variant = 'default' } = options;
        if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0 || duration > 2147483647) throw new Error('Toast duration must be finite milliseconds from 0 to 2147483647.');
        if (!variants.includes(variant)) throw new Error('Toast variant is invalid.');
        // Drop the oldest instead of throwing: toast.error() often runs in a catch
        // block, and a throw there would mask the original error.
        const kept = items.slice(Math.max(0, items.length - maxToasts + 1));
        for (const item of items) if (!kept.includes(item)) cancel(item.id);
        const id = `toast-${++nextToastId}`;
        items = Object.freeze([...kept, Object.freeze({ id, message, duration, variant })]);
        if (duration > 0) clocks.set(id, { remaining: duration, started: 0 });
        schedule(); notify(); return id;
    };
    const withVariant = (message: string, options: Omit<ToastOptions, 'variant'> = {}, variant: ToastVariant) => {
        if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'duration')) throw new Error('Toast variant helpers accept only duration.');
        return show(message, { ...options, variant });
    };
    const store: ToastStore = Object.freeze({
        get: () => items,
        subscribe(listener: (items: readonly ToastItem[]) => void) {
            check();
            if (typeof listener !== 'function') throw new Error('Toast subscriber must be a function.');
            listeners.add(listener);
            try { listener(items); } catch (error) { listeners.delete(listener); throw error; }
            return () => { listeners.delete(listener); };
        },
        show,
        success: (message: string, options?: Omit<ToastOptions, 'variant'>) => withVariant(message, options, 'success'),
        warning: (message: string, options?: Omit<ToastOptions, 'variant'>) => withVariant(message, options, 'warning'),
        error: (message: string, options?: Omit<ToastOptions, 'variant'>) => withVariant(message, options, 'destructive'),
        dismiss(id: string) { check(); if (!items.some(item => item.id === id)) return; cancel(id); items = Object.freeze(items.filter(item => item.id !== id)); notify(); },
        clear() { check(); clear(); },
        dispose() { requireBrowser(); if (disposed) return; disposed = true; mounted = false; pauses.clear(); try { clear(); } finally { listeners.clear(); } },
    });
    presenters.set(store, () => {
        check(); if (mounted) throw new Error('Toast store already has a mounted Toaster. Use an isolated store for another presenter.');
        mounted = true; schedule(); let released = false;
        return {
            pause(reason, paused) {
                if (released || disposed) return;
                if (paused) {
                    if (!pauses.size) for (const clock of clocks.values()) if (clock.timer !== undefined) {
                        clearTimeout(clock.timer); clock.timer = undefined;
                        clock.remaining = Math.max(0, clock.remaining - (performance.now() - clock.started));
                    }
                    pauses.add(reason);
                } else { pauses.delete(reason); schedule(); }
            },
            release() { if (released) return; released = true; mounted = false; pauses.clear(); clear(); },
        };
    });
    return store;
}

/** Browser-only convenience store. Mount one default Toaster in the application root. */
export const toastStore: ToastStore = createToastStore();
export const toast = toastStore;

export type ToasterProps = Omit<GlobalAttributes<HTMLDivElement>, 'role' | 'tabindex' | 'aria-label' | 'aria-labelledby' | 'aria-live' | 'aria-atomic' | 'aria-relevant'> & {
    position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'bottom-center';
    /** Accessible notification region name. */
    label?: string;
    /** Prefix for each dismissal button's accessible name. */
    dismissLabel?: string;
    /** Store identity stays fixed for the lifetime of this presenter. */
    store?: ToastStore;
};
const positions = {
    'top-right': 'top-0 right-0', 'top-left': 'top-0 left-0',
    'bottom-right': 'bottom-0 right-0', 'bottom-left': 'bottom-0 left-0',
    'bottom-center': 'bottom-0 left-1/2 -translate-x-1/2',
};
// A toast looks like an inline status message: a tinted, bordered card in the page's text colour,
// with the tone carried by its border, background and icon.
const styles: Record<ToastVariant, string> = {
    default: 'border-border bg-card', success: 'border-success/40 bg-success/10',
    warning: 'border-warning/40 bg-warning/10', destructive: 'border-destructive/40 bg-destructive/10',
};
const icons: Record<ToastVariant, { entry: IconEntry; tone: string }> = {
    default: { entry: InfoCircleIcon, tone: 'text-muted-foreground' }, success: { entry: CheckCircleIcon, tone: 'text-success-text' },
    warning: { entry: DangerTriangleIcon, tone: 'text-warning-text' }, destructive: { entry: DangerCircleIcon, tone: 'text-destructive' },
};

/** A named notification region with one live announcer and owned browser lifecycle. */
@Component()
export class Toaster extends Cossack {
    declare props: ToasterProps;
    @ClientState() private toasts: readonly ToastItem[] = [];
    private rootElement?: HTMLDivElement;
    private connectedStore?: ToastStore;
    private releaseResources?: () => void;
    private previousFocus?: HTMLElement;
    private generation = 0;

    render() {
        const { position = 'bottom-right', label = 'Notifications', dismissLabel = 'Dismiss', store = toastStore, ...rest } = this.props;
        if (!Object.hasOwn(positions, position)) throw new Error('Toaster position is invalid.');
        if (typeof label !== 'string' || !label.trim() || typeof dismissLabel !== 'string' || !dismissLabel.trim()) throw new Error('Toaster requires nonempty label and dismissLabel.');
        if (!presenters.has(store)) throw new Error('Toaster requires a live store from createToastStore.');
        if (this.connectedStore && this.connectedStore !== store) throw new Error('Toaster store cannot change while mounted. Remount the presenter.');
        if (this.children != null && this.children !== false && this.children !== '') throw new Error('Toaster renders store messages, not children.');
        // popover="manual" puts the region in the top layer once shown, above
        // modal dialogs that make the rest of the document inert. The resets
        // undo the UA popover box; fixed/z-index remain the fallback.
        return html`<div class=${`cs-toaster fixed z-[100] inset-auto m-0 border-0 bg-transparent overflow-visible flex flex-col gap-2 p-4 pointer-events-none w-full max-w-[432px] ${positions[position]}`}
            popover="manual" ...=${rest} role="region" aria-label=${label} tabindex="-1" ref=${(element: Element) => { this.rootElement = element as HTMLDivElement; this.schedulePresenter(); }}>
            <div class="sr-only" role="status" aria-live="polite" aria-atomic="false" aria-relevant="additions">${repeat(this.toasts, item => item.id, item => html`<div>${item.message}</div>`)}</div>
            <ol class="cs-toaster__items flex flex-col gap-2 m-0 p-0 list-none">${repeat(this.toasts, item => item.id, item => html`<li data-toast-id=${item.id}
                class=${`cs-toast cs-toast--${item.variant} pointer-events-auto flex items-start gap-3 rounded-md border px-3 py-2 w-full min-w-0 break-words text-sm text-foreground shadow-xs ${styles[item.variant]}`}>
                <span aria-hidden="true" class=${`mt-0.5 shrink-0 [&_svg]:size-4 ${icons[item.variant].tone}`}>${component(Icon, { entry: icons[item.variant].entry, size: 16 })}</span>
                <span class="min-w-0 flex-1 leading-5">${item.message}</span>
                <button type="button" class="cs-toast__close -me-1 -mt-0.5 size-6 shrink-0 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label=${`${dismissLabel}: ${item.message}`} @click=${() => store.dismiss(item.id)}><span aria-hidden="true">${component(Icon, { entry: CloseCircleIcon, size: 16 })}</span></button>
            </li>`)}</ol>
        </div>`;
    }

    onMount() { this.schedulePresenter(); }
    private schedulePresenter() {
        const generation = this.generation;
        queueMicrotask(() => {
            if (generation !== this.generation || this.connectedStore || !this.rootElement?.isConnected) return;
            try { this.mountPresenter(); } catch (error) { this.onCleanup(); throw error; }
        });
    }
    private mountPresenter() {
        const root = this.rootElement, store = this.props.store ?? toastStore;
        if (!root?.isConnected) throw new Error('Toaster must mount in a live document.');
        const presenter = presenters.get(store)!();
        this.connectedStore = store;
        const document = root.ownerDocument, window = document.defaultView!;
        const focusIn = (event: FocusEvent) => {
            if (event.relatedTarget instanceof window.HTMLElement && !root.contains(event.relatedTarget)) this.previousFocus = event.relatedTarget;
            presenter.pause('focus', true);
        };
        const focusOut = () => queueMicrotask(() => { presenter.pause('focus', root.contains(document.activeElement)); });
        const enter = () => presenter.pause('hover', true), leave = () => presenter.pause('hover', false);
        const visibility = () => presenter.pause('hidden', document.visibilityState === 'hidden');
        const blur = () => presenter.pause('window', true), focus = () => presenter.pause('window', false);
        const keydown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey) return;
            const item = (event.target as Element).closest<HTMLElement>('[data-toast-id]');
            if (item && root.contains(item)) { event.preventDefault(); store.dismiss(item.dataset.toastId!); }
        };
        root.addEventListener('focusin', focusIn); root.addEventListener('focusout', focusOut);
        root.addEventListener('mouseenter', enter); root.addEventListener('mouseleave', leave); root.addEventListener('keydown', keydown);
        document.addEventListener('visibilitychange', visibility); window.addEventListener('blur', blur); window.addEventListener('focus', focus);
        visibility(); presenter.pause('window', !document.hasFocus()); presenter.pause('focus', root.contains(document.activeElement));
        // A modal <dialog> makes everything outside it inert, the top layer
        // included. While one is open, the region moves into the topmost modal
        // and shows as a manual popover, so it paints above the dialog and stays
        // interactive. It returns to its own place when the last modal closes.
        const topLayer = typeof root.showPopover === 'function' && root.hasAttribute('popover');
        const home = { parent: root.parentNode, next: root.nextSibling };
        const modals = () => { try { return [...document.querySelectorAll<HTMLDialogElement>('dialog:modal')]; } catch { return []; } };
        const place = () => {
            const open = modals(), modal = open.find(dialog => dialog.contains(document.activeElement)) ?? open.at(-1);
            if (modal && root.parentNode !== modal) modal.append(root);
            else if (!modal && root.parentNode !== home.parent) {
                if (home.next?.parentNode === home.parent) home.parent!.insertBefore(root, home.next);
                else if (home.parent?.isConnected) home.parent.appendChild(root);
            }
            if (topLayer && root.isConnected && !root.matches(':popover-open')) root.showPopover();
        };
        place();
        const observer = new MutationObserver(records => {
            if (!root.isConnected || records.some(record => record.type === 'attributes' && record.target instanceof window.HTMLDialogElement)) place();
        });
        observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
        let unsubscribe: (() => void) | undefined;
        this.releaseResources = () => {
            unsubscribe?.();
            observer.disconnect();
            if (topLayer && root.matches(':popover-open')) root.hidePopover();
            // The renderer removes the region only from its own place.
            if (root.parentNode !== home.parent) root.remove();
            root.removeEventListener('focusin', focusIn); root.removeEventListener('focusout', focusOut);
            root.removeEventListener('mouseenter', enter); root.removeEventListener('mouseleave', leave); root.removeEventListener('keydown', keydown);
            document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', blur); window.removeEventListener('focus', focus);
            presenter.release();
        };
        unsubscribe = store.subscribe(items => {
            const active = document.activeElement as HTMLElement | null;
            const focusedId = active && root.contains(active) ? active.closest<HTMLElement>('[data-toast-id]')?.dataset.toastId : undefined;
            const removed = focusedId !== undefined && !items.some(item => item.id === focusedId);
            const generation = this.generation;
            this.toasts = items;
            if (removed) queueMicrotask(() => {
                if (generation !== this.generation || !root.isConnected || (document.activeElement !== active && document.activeElement !== document.body)) return;
                const targets = [...root.querySelectorAll<HTMLButtonElement>('.cs-toast__close'), this.previousFocus, root];
                for (const target of targets) {
                    if (!target?.isConnected || target.matches(':disabled') || target.closest('[inert],[hidden]') || !target.getClientRects().length) continue;
                    target.focus({ preventScroll: true });
                    if (document.activeElement === target) break;
                }
            });
        });
    }
    onCleanup() {
        this.generation++;
        try { this.releaseResources?.(); } finally { this.releaseResources = undefined; this.connectedStore = undefined; this.rootElement = undefined; this.previousFocus = undefined; }
    }
}
