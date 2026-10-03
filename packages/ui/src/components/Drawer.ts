import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component, Client, createRef, type RefObject } from "@cossackframework/core";
import { DialogController, type DialogControlProps } from "../internal/dialog";

export type DrawerProps = Omit<DialogControlProps, 'title'> & {
    side?: "top" | "bottom" | "left" | "right";
    /** Panel width/height as a CSS length. */
    size?: string;
    /** Visible heading and default accessible dialog name. */
    title?: string;
    closeLabel?: string;
    showCloseButton?: boolean;
};

const SIDE_DIM: Record<string, { dim: string; val: string }> = {
    left: { dim: "width", val: "380px" },
    right: { dim: "width", val: "380px" },
    top: { dim: "height", val: "auto" },
    bottom: { dim: "height", val: "auto" },
};

const SIDE_POS: Record<string, string> = {
    left: "top:0;left:0;height:100%",
    right: "top:0;right:0;height:100%",
    top: "top:0;left:0;width:100%",
    bottom: "bottom:0;left:0;width:100%",
};

/** Edge-attached native modal dialog with a heading and localizable close control. */
@Component()
export class Drawer extends Cossack {
    declare props: DrawerProps;
    dialogRef: RefObject<HTMLDialogElement> = createRef<HTMLDialogElement>();
    private dialog = new DialogController(() => this.props, () => this.requestUpdate());

    render() {
        const { open: _open, defaultOpen: _default, closeOnBackdrop: _backdrop, closeOnEscape: _escape, onClose: _close,
            side = 'right', size, title, closeLabel = 'Close', showCloseButton = true, ...rest } = this.props;
        const dims = SIDE_DIM[side];
        if (!dims) throw new Error('Drawer side must be left, right, top or bottom.');
        const style = `${SIDE_POS[side]};${dims.dim}:${size || dims.val};${dims.dim === 'width' ? 'max-width:90vw' : 'max-height:85vh'};`;
        const attrs = { ...rest, 'aria-label': rest['aria-label'] ?? (rest['aria-labelledby'] ? undefined : title), ...this.dialog.events() };
        return html`<dialog ref=${(element: Element) => { this.dialogRef.value = element as HTMLDialogElement; this.dialog.connect(element as HTMLDialogElement); }}
            class="cs-drawer" ...=${attrs}>
            <div data-dialog-panel class=${classMap({ 'cs-drawer__panel fixed bg-popover text-popover-foreground shadow-lg flex flex-col z-[100]': true,
                [`cs-drawer--${side}`]: true, 'rounded-t-2xl': side === 'bottom', 'rounded-b-2xl': side === 'top', 'rounded-r-2xl': side === 'left', 'rounded-l-2xl': side === 'right' })} style=${style}>
                ${side === 'top' || side === 'bottom' ? html`<div aria-hidden="true" class="cs-drawer__handle pt-3 pb-2 flex justify-center"><span class="block w-10 h-1.5 rounded-full bg-muted-foreground/30"></span></div>` : null}
                ${title || showCloseButton ? html`<div class="cs-drawer__header px-4 py-3 border-b flex items-center justify-between gap-2">
                    ${title ? html`<h2 class="text-sm font-semibold">${title}</h2>` : null}
                    ${showCloseButton ? html`<button type="button" class="cs-drawer__close size-7 rounded-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring" aria-label=${closeLabel}
                        @click=${() => this.close()}><span aria-hidden="true">×</span></button>` : null}
                </div>` : null}
                <div class="cs-drawer__body flex-1 overflow-y-auto px-4 py-3">${this.children}</div>
            </div>
        </dialog>`;
    }
    @Client()
    close() { this.dialog.close(); }
    onCleanup() { this.dialog.disconnect(); this.dialogRef.value = undefined; }
}
