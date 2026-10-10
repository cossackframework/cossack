import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component, createRef, type RefObject } from "@cossackframework/core";
import { DialogController, type DialogControlProps } from "../internal/dialog";

export type SheetProps = DialogControlProps & {
    side?: "left" | "right" | "top" | "bottom";
    /** Panel width/height as a CSS length. */
    size?: string;
    fullScreen?: boolean;
};

const SIDE_POSITION: Record<string, string> = {
    left: "top:0;left:0;height:100%",
    right: "top:0;right:0;height:100%",
    top: "top:0;left:0;width:100%",
    bottom: "bottom:0;left:0;width:100%",
};

const SIDE_DIMENSIONS: Record<string, { dim: string; val: string }> = {
    left: { dim: "width", val: "400px" },
    right: { dim: "width", val: "400px" },
    top: { dim: "height", val: "300px" },
    bottom: { dim: "height", val: "300px" },
};

/** Edge-attached native modal dialog. Attributes and events target the dialog. */
@Component()
export class Sheet extends Cossack {
    declare props: SheetProps;
    dialogRef: RefObject<HTMLDialogElement> = createRef<HTMLDialogElement>();
    private dialog = new DialogController(() => this.props, () => this.requestUpdate());

    render() {
        const { open: _open, defaultOpen: _default, closeOnBackdrop: _backdrop, closeOnEscape: _escape, onClose: _close,
            side = 'right', size, fullScreen = false, ...rest } = this.props;
        const dims = SIDE_DIMENSIONS[side];
        if (!dims) throw new Error('Sheet side must be left, right, top or bottom.');
        const value = fullScreen ? (dims.dim === 'width' ? '100vw' : '100vh') : size || dims.val;
        const style = `${SIDE_POSITION[side]};${dims.dim}:${value};${dims.dim === 'width' ? 'max-width' : 'max-height'}:${fullScreen ? '100' : dims.dim === 'width' ? '90' : '85'}${dims.dim === 'width' ? 'vw' : 'vh'};`;
        return html`<dialog ref=${(element: Element) => { this.dialogRef.value = element as HTMLDialogElement; this.dialog.connect(element as HTMLDialogElement); }}
            class="cs-sheet" ...=${{ ...rest, ...this.dialog.events() }}>
            <div data-dialog-panel class=${classMap({ 'cs-sheet__panel fixed bg-popover text-popover-foreground shadow-lg border flex flex-col z-[100]': true,
                [`cs-sheet--${side}`]: true, 'border-r': side === 'left', 'border-l': side === 'right', 'border-b': side === 'top', 'border-t': side === 'bottom' })}
                style=${style}>${this.children}</div>
        </dialog>`;
    }
    onCleanup() { this.dialog.disconnect(); this.dialogRef.value = undefined; }
}
