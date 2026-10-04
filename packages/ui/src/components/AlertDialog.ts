import { html, classMap } from '@cossackframework/renderer';
import { Cossack, Component, Client, createRef, type RefObject } from '@cossackframework/core';
import { DialogController, type DialogControlProps } from '../internal/dialog';
import type { ControlEvent } from '../native-attributes';

export type AlertDialogProps = Omit<DialogControlProps, 'id' | 'title' | 'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'closeOnBackdrop'> & {
    /** Stable page-unique ID; derived IDs label and describe the dialog. */
    id: string;
    title: string;
    description?: string;
    cancelLabel?: string;
    actionLabel?: string;
    actionVariant?: 'primary' | 'destructive';
    /** Disable confirmation while an application-owned operation is pending. */
    actionDisabled?: boolean;
    /** Confirmation does not dismiss. The caller owns asynchronous work and closing. */
    onAction?: (event: ControlEvent<HTMLButtonElement, PointerEvent>) => unknown;
};

/** Native alert dialog. Backdrop clicks never dismiss; Cancel receives initial focus. */
@Component()
export class AlertDialog extends Cossack {
    declare props: AlertDialogProps;
    dialogRef: RefObject<HTMLDialogElement> = createRef<HTMLDialogElement>();
    private dialog = new DialogController(() => ({ ...this.props, closeOnBackdrop: false }), () => this.requestUpdate());

    render() {
        const { id, title, description, cancelLabel = 'Cancel', actionLabel = 'Confirm', actionVariant = 'destructive',
            actionDisabled = false, onAction, open: _open, defaultOpen: _default, closeOnEscape: _escape, onClose: _close, ...rest } = this.props;
        if (typeof id !== 'string' || !id || /\s/.test(id)) throw new Error('AlertDialog requires a nonempty, whitespace-free id.');
        for (const [name, value] of [['title', title], ['cancelLabel', cancelLabel], ['actionLabel', actionLabel]]) {
            if (typeof value !== 'string' || !value.trim()) throw new Error(`AlertDialog requires a nonempty ${name}.`);
        }
        if (description !== undefined && typeof description !== 'string') throw new Error('AlertDialog description must be text.');
        if (!['primary', 'destructive'].includes(actionVariant)) throw new Error('AlertDialog actionVariant must be primary or destructive.');
        const actionClass = classMap({
            "cs-alert-dialog__action": true,
            "inline-flex items-center justify-center h-9 px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors outline-none disabled:opacity-50 disabled:cursor-not-allowed": true,
            "bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 focus-visible:ring-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-[3px]": actionVariant === "destructive",
            "bg-primary text-primary-foreground border border-transparent shadow-xs hover:bg-primary/90 focus-visible:ring-ring/50 focus-visible:ring-[3px]": actionVariant === "primary",
        });

        return html`<dialog
            ref=${(element: Element) => { this.dialogRef.value = element as HTMLDialogElement; this.dialog.connect(element as HTMLDialogElement); }}
            id=${id} role="alertdialog" aria-modal="true" aria-labelledby=${`${id}-title`}
            aria-describedby=${description ? `${id}-description` : undefined}
            class="cs-alert-dialog m-auto p-0 bg-transparent max-w-none max-h-none overflow-hidden"
            ...=${{ ...rest, ...this.dialog.events() }}>
            <div data-dialog-panel class="cs-alert-dialog__panel w-full max-w-md bg-popover text-popover-foreground rounded-lg shadow-xl border p-6">
                <h2 id=${`${id}-title`} class="cs-alert-dialog__title text-lg font-semibold mb-2">${title}</h2>
                ${description ? html`<p id=${`${id}-description`} class="cs-alert-dialog__description text-sm text-muted-foreground mb-6">${description}</p>` : null}
                <div class="cs-alert-dialog__footer flex justify-end gap-2">
                    <button type="button" autofocus
                        class="cs-alert-dialog__cancel inline-flex items-center justify-center h-9 px-4 py-2 text-sm font-medium rounded-md border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none transition-colors focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                        @click=${() => this.dialog.close()}>${cancelLabel}</button>
                    <button type="button" class=${actionClass} ?disabled=${actionDisabled}
                        @click=${(event: ControlEvent<HTMLButtonElement, PointerEvent>) => { if (!this.props.actionDisabled) onAction?.(event); }}>${actionLabel}</button>
                </div>
            </div>
        </dialog>`;
    }
    /** Explicit dismissal for uncontrolled consumers. Controlled consumers must accept onClose. */
    @Client() close() { this.dialog.close(); }
    onCleanup() { this.dialog.disconnect(); this.dialogRef.value = undefined; }
}
