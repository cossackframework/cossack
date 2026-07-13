import { html, classMap } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    Task,
    createRef,
    type RefObject,
} from "@cossackframework/core";

export interface SheetProps {
    /** Controlled open state. */
    open?: boolean;
    /** Which edge the sheet slides in from. */
    side?: "left" | "right" | "top" | "bottom";
    /** Panel width for left/right (CSS value). Default "400px". */
    size?: string;
    /** Close when the backdrop is clicked. Default true. */
    closeOnBackdrop?: boolean;
    /** Callback fired when the sheet closes. */
    onClose?: () => void;
    /** Allow arbitrary HTML attributes. */
    [key: string]: any;
}

const SIDE_CLASSES: Record<string, string> = {
    left: "cs-sheet--left top-0 left-0 h-full",
    right: "cs-sheet--right top-0 right-0 h-full",
    top: "cs-sheet--top top-0 left-0 w-full",
    bottom: "cs-sheet--bottom bottom-0 left-0 w-full",
};

const SIDE_DIMENSIONS: Record<string, { dim: string; val: string }> = {
    left: { dim: "width", val: "400px" },
    right: { dim: "width", val: "400px" },
    top: { dim: "height", val: "300px" },
    bottom: { dim: "height", val: "300px" },
};

/**
 * Cossack UI Sheet (Drawer) — slide-in panel built on native `<dialog>`.
 *
 * Uses `dialog.showModal()` for top-layer rendering + focus + ESC dismiss.
 * The `@Task syncOpenState` drives open/close when the controlled `open` prop
 * changes (same pattern as Modal).
 *
 *   ${component(Sheet, {
 *       open: this.showSheet,
 *       side: 'right',
 *       onClose: () => this.showSheet = false,
 *   }, html\`<p>Sheet content</p>\`)}
 */
@Component()
export class Sheet extends Cossack {
    declare props: SheetProps;

    dialogRef: RefObject<HTMLDialogElement> = createRef<HTMLDialogElement>();

    render() {
        const {
            open: _open,
            side = "right",
            size,
            closeOnBackdrop = true,
            ...rest
        } = this.props;

        const dims = SIDE_DIMENSIONS[side];
        const dimValue = size || dims.val;
        const panelStyle =
            dims.dim === "width" ? `width:${dimValue};max-width:90vw;` : `height:${dimValue};max-height:85vh;`;

        const panelClasses = classMap({
            "cs-sheet__panel": true,
            [SIDE_CLASSES[side]]: true,
            "absolute bg-background text-foreground shadow-2xl border-border flex flex-col": true,
            "border-r": side === "left",
            "border-l": side === "right",
            "border-b": side === "top",
            "border-t": side === "bottom",
        });

        return html`
            <dialog
                ref=${this.dialogRef}
                class="cs-sheet m-0 p-0 bg-transparent max-w-none max-h-none overflow-hidden"
                @close=${() => {
                    const onClose = this.props.onClose ?? this.props["@close"];
                    if (typeof onClose === "function") onClose();
                }}
                @click=${(e: MouseEvent) => {
                    if (closeOnBackdrop && e.target === this.dialogRef.value) {
                        const dlg = this.dialogRef.value;
                        if (dlg && dlg.open) dlg.close();
                    }
                }}
            >
                <div class=${panelClasses} style=${panelStyle}>
                    ${this.children}
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
