import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component, Task, createRef, type RefObject } from "@cossackframework/core";

export interface AlertDialogProps {
    open?: boolean;
    /** Title shown at the top. */
    title?: unknown;
    /** Body description. */
    description?: unknown;
    /** Cancel button text. Default "Cancel". */
    cancelLabel?: string;
    /** Action button text. Default "Confirm". */
    actionLabel?: string;
    /** Action button variant. Default "destructive". */
    actionVariant?: "primary" | "destructive";
    /** Called when the user confirms. */
    onAction?: () => void;
    /** Called when the dialog closes (cancel, ESC, backdrop). */
    onClose?: () => void;
    [key: string]: any;
}

/**
 * Cossack UI AlertDialog — a modal that requires a user decision before
 * closing. Built on native `<dialog>` (same as Modal) but with built-in
 * title/description/action/cancel layout. Unlike Modal, it does NOT close on
 * backdrop click (forces an explicit choice).
 *
 *   ${component(AlertDialog, {
 *       open: this.showConfirm,
 *       title: 'Delete account?',
 *       description: 'This action cannot be undone.',
 *       onAction: () => { this.delete(); this.showConfirm = false; },
 *       onClose: () => { this.showConfirm = false; },
 *   })}
 */
@Component()
export class AlertDialog extends Cossack {
    declare props: AlertDialogProps;

    dialogRef: RefObject<HTMLDialogElement> = createRef<HTMLDialogElement>();

    render() {
        const {
            title,
            description,
            cancelLabel = "Cancel",
            actionLabel = "Confirm",
            actionVariant = "destructive",
            onAction,
            onClose,
        } = this.props;

        const actionClass = classMap({
            "cs-alert-dialog__action": true,
            "inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md cursor-pointer border-none transition-colors": true,
            "bg-destructive text-destructive-foreground hover:opacity-90": actionVariant === "destructive",
            "bg-primary text-primary-foreground hover:opacity-90": actionVariant === "primary",
        });

        return html`
            <dialog
                ref=${this.dialogRef}
                class="cs-alert-dialog m-auto p-0 bg-transparent max-w-none max-h-none overflow-hidden"
                @close=${() => { if (typeof onClose === "function") onClose(); }}
                @cancel=${(e: Event) => { if (!this.props.open) e.preventDefault(); }}
            >
                <div class="cs-alert-dialog__panel w-full max-w-md bg-background text-foreground rounded-lg shadow-xl border border-border p-6">
                    ${title ? html`<h2 class="cs-alert-dialog__title text-lg font-semibold mb-2">${title}</h2>` : null}
                    ${description ? html`<p class="cs-alert-dialog__description text-sm text-muted-foreground mb-6">${description}</p>` : null}
                    <div class="cs-alert-dialog__footer flex justify-end gap-2">
                        <button type="button"
                            class="cs-alert-dialog__cancel inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md border border-border bg-transparent text-foreground hover:bg-muted cursor-pointer transition-colors"
                            @click=${() => { if (typeof onClose === "function") onClose(); }}
                        >${cancelLabel}</button>
                        <button type="button"
                            class=${actionClass}
                            @click=${() => { if (typeof onAction === "function") onAction(); }}
                        >${actionLabel}</button>
                    </div>
                </div>
            </dialog>
        `;
    }

    @Task()
    syncOpenState() {
        if (this.isServer) return;
        const dlg = this.dialogRef.value;
        if (!dlg) return;
        const wantOpen = !!this.props.open;
        if (wantOpen && !dlg.open) {
            try { dlg.showModal(); } catch { /* not connected */ }
        } else if (!wantOpen && dlg.open) {
            dlg.close();
        }
    }
}
