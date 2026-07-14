import { html, classMap } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    ClientTask,
    createRef,
    type RefObject,
} from "@cossackframework/core";

export interface ModalProps {
    /** Controlled open state. When flipped, the <dialog> is shown/closed. */
    open?: boolean;
    /** Close when the backdrop (the dialog element itself) is clicked. Default true. */
    closeOnBackdrop?: boolean;
    /** Close when Escape is pressed. Default true (native <dialog> behavior). */
    closeOnEscape?: boolean;
    /** Max width token class for the panel, e.g. "max-w-lg". */
    size?: string;
    /** Callback fired when the dialog closes (ESC, backdrop, or close()). */
    onClose?: () => void;
    /** Allow arbitrary HTML attributes to spread onto the <dialog>. */
    [key: string]: any;
}

/**
 * Cossack UI Modal — built on the native `<dialog>` element.
 *
 * Controlled: the parent owns the `open` prop. When it flips, this component
 * re-renders, the `@Task` method fires, and the native dialog API
 * (`showModal()` / `close()`) reconciles the element with the desired state.
 * The native `close`/`cancel` events are non-bubbling, so they're bound inline
 * on the `<dialog>` (the `@On` decorator listens on the component root and
 * wouldn't catch them).
 *
 *   ${component(Modal, { open: this.show, onClose: () => this.show = false },
 *       html\`<p>Body</p>\`)}
 *
 * Implementation note: we use `@Task` (not an `updated()` override) because
 * `updated` is not in the security plugin's client-bundle allowlist and would
 * be stripped. `@Task` runs on mount + every render on both sides; we guard
 * the DOM access so SSR is a no-op.
 */
@Component()
export class Modal extends Cossack {
    declare props: ModalProps;

    dialogRef: RefObject<HTMLDialogElement> = createRef<HTMLDialogElement>();

    render() {
        const { closeOnBackdrop = true, closeOnEscape = true, size } = this.props;
        const panelClass = size || "max-w-lg";

        const panelClasses = classMap({
            "cs-modal__panel": true,
            [panelClass]: true,
            "w-full bg-background text-foreground rounded-lg shadow-xl border border-border p-6": true,
        });

        return html`
            <dialog
                ref=${this.dialogRef}
                class="cs-modal m-auto p-0 bg-transparent max-w-none max-h-none overflow-hidden"
                @close=${() => {
                    const onClose = this.props.onClose ?? this.props["@close"];
                    if (typeof onClose === "function") onClose();
                }}
                @cancel=${(e: Event) => {
                    if (!closeOnEscape) e.preventDefault();
                }}
                @click=${(e: MouseEvent) => {
                    if (closeOnBackdrop && e.target === this.dialogRef.value) {
                        const dlg = this.dialogRef.value;
                        if (dlg && dlg.open) dlg.close();
                    }
                }}
            >
                <div class=${panelClasses}>
                    ${this.children}
                </div>
            </dialog>
        `;
    }

    /**
     * Reconcile the native <dialog> open state with the `open` prop.
     * Runs on the client during mount + every re-render.
     */
    @ClientTask()
    syncOpenState() {
        const dlg = this.dialogRef.value;
        if (!dlg) return;
        const wantOpen = !!this.props.open;
        if (wantOpen && !dlg.open) {
            try {
                dlg.showModal();
            } catch {
                /* not connected yet */
            }
        } else if (!wantOpen && dlg.open) {
            dlg.close();
        }
    }
}
