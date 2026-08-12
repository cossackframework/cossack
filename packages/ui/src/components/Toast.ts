import { html, classMap, component } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    ClientState,
    createStore,
    connectStore,
    type ReactiveStore,
} from "@cossackframework/core";
import { Icon } from "../icons/Icon";
import { CloseCircleIcon as closeCircleIcon } from "@cossackframework/solar-icons/close-circle";

// ---------------------------------------------------------------------------
// Global toast store — a module-level singleton. Any code in the app can call
// `toast.success("Saved")` to push a toast, and any mounted <Toaster /> will
// render it. This uses the framework's reactive-store primitive so consumers
// re-render when the queue changes.
// ---------------------------------------------------------------------------

export interface ToastItem {
    id: string;
    message: string;
    variant?: "default" | "success" | "warning" | "destructive";
    /** Auto-dismiss after N ms. 0 = sticky. Default 4000. */
    duration?: number;
}

export const toastStore: ReactiveStore<ToastItem[]> = createStore<ToastItem[]>([]);

function pushToast(message: string, opts?: Partial<Omit<ToastItem, "id" | "message">>) {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const duration = opts?.duration ?? 4000;
    const item: ToastItem = {
        id,
        message,
        variant: opts?.variant ?? "default",
        duration,
    };
    toastStore.update((queue) => [...queue, item]);

    // Auto-dismiss
    if (duration > 0 && typeof window !== "undefined") {
        setTimeout(() => dismissToast(id), duration);
    }
    return id;
}

function dismissToast(id: string) {
    toastStore.update((queue) => queue.filter((t) => t.id !== id));
}

/**
 * Global imperative toast API. Callable from anywhere (server methods, client
 * handlers, services).
 *
 *   import { toast } from '@cossackframework/ui';
 *   toast.success('Saved!');
 *   toast.error('Something went wrong.');
 *   toast.show('Hello', { duration: 6000 });
 *   toast.dismiss(id);
 */
export const toast = {
    show: pushToast,
    success: (msg: string, opts?: Partial<ToastItem>) => pushToast(msg, { ...opts, variant: "success" }),
    warning: (msg: string, opts?: Partial<ToastItem>) => pushToast(msg, { ...opts, variant: "warning" }),
    error: (msg: string, opts?: Partial<ToastItem>) => pushToast(msg, { ...opts, variant: "destructive" }),
    dismiss: dismissToast,
};

// ---------------------------------------------------------------------------
// Toaster component — mount once (typically in the App root) to render the
// toast queue. Renders in the top-right via fixed positioning.
// ---------------------------------------------------------------------------

const VARIANT_STYLES: Record<string, string> = {
    default: "bg-popover text-popover-foreground border",
    success: "bg-success/10 text-success-text border-transparent",
    warning: "bg-warning/10 text-warning-text border-transparent",
    destructive: "bg-destructive/10 text-destructive border-transparent",
};

export interface ToasterProps {
    /** Position of the toast stack. */
    position?: "top-right" | "top-left" | "bottom-right" | "bottom-left" | "bottom-center";
    [key: string]: any;
}

/**
 * Cossack UI Toaster — mount once to display toasts pushed via the global
 * `toast` API. Subscribes to `toastStore` (a reactive store) and re-renders
 * when the queue changes.
 *
 *   // In App root:
 *   ${component(Toaster, {})}
 *
 *   // Anywhere:
 *   toast.success('Saved!');
 */
@Component()
export class Toaster extends Cossack {
    declare props: ToasterProps;

    @ClientState() private toasts: ToastItem[] = [];
    private _unsub?: () => void;

    render() {
        const { position = "bottom-right" } = this.props;

        const containerClasses = classMap({
            "cs-toaster": true,
            "fixed z-[100] flex flex-col gap-2 p-4 pointer-events-none": true,
            "top-0 right-0": position === "top-right",
            "top-0 left-0": position === "top-left",
            "bottom-0 right-0": position === "bottom-right",
            "bottom-0 left-0": position === "bottom-left",
            "bottom-0 left-1/2 -translate-x-1/2": position === "bottom-center",
        });

        return html`
            <div class=${containerClasses} aria-live="polite" aria-atomic="true">
                ${this.toasts.map(
                    (t) => html`
                        <div
                            class=${classMap({
                                "cs-toast": true,
                                "cs-toast--animate-in": true,
                                "pointer-events-auto rounded-md border shadow-lg p-4 pr-10 min-w-[300px] max-w-[400px] text-sm relative": true,
                                [VARIANT_STYLES[t.variant || "default"] || VARIANT_STYLES.default]: true,
                            })}
                            role="status"
                        >
                            ${t.message}
                            <button
                                class="cs-toast__close absolute top-2 right-2 size-6 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer bg-transparent border-none [&_svg]:size-4 transition-colors"
                                aria-label="Dismiss"
                                @click=${() => dismissToast(t.id)}
                            >
                                ${component(Icon, { entry: closeCircleIcon, size: 16 })}
                            </button>
                        </div>
                    `,
                )}
            </div>
        `;
    }

    onMount() {
        this._unsub = connectStore(toastStore, this as any, "toasts");
    }

    onCleanup() {
        this._unsub?.();
    }
}
