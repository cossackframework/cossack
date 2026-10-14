import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component, createRef, type RefObject } from "@cossackframework/core";
import { DialogController, type DialogControlProps } from "../internal/dialog";

export type ModalProps = DialogControlProps & {
    /** Max-width utility class for the panel. Default max-w-lg. */
    size?: string;
};

/** Native modal dialog. Supply aria-label or aria-labelledby for its accessible name. */
@Component()
export class Modal extends Cossack {
    declare props: ModalProps;
    dialogRef: RefObject<HTMLDialogElement> = createRef<HTMLDialogElement>();
    private dialog = new DialogController(() => this.props, () => this.requestUpdate());

    render() {
        const { open: _open, defaultOpen: _default, closeOnBackdrop: _backdrop, closeOnEscape: _escape, onOpenChange: _change, size = 'max-w-lg', ...rest } = this.props;
        return html`<dialog ref=${(element: Element) => { this.dialogRef.value = element as HTMLDialogElement; this.dialog.connect(element as HTMLDialogElement); }}
            class="cs-modal m-auto p-0 bg-transparent max-w-none max-h-none overflow-hidden" ...=${{ ...rest, ...this.dialog.events() }}>
            <div data-dialog-panel class=${classMap({ 'cs-modal__panel w-full bg-popover text-popover-foreground rounded-lg shadow-xl border p-6': true, [size]: true })}>${this.children}</div>
        </dialog>`;
    }
    onCleanup() { this.dialog.disconnect(); this.dialogRef.value = undefined; }
}
