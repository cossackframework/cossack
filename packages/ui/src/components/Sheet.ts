import { html, classMap } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    ClientTask,
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

/**
 * Cossack UI Sheet (Drawer) — slide-in panel built on native `<dialog>`.
 *
 * The panel slides in from the specified edge (right by default) using a CSS
 * transform transition. Uses `dialog.showModal()` for top-layer rendering,
 * focus management, and ESC dismiss — but does NOT manipulate body scroll
 * (the top layer handles that natively, and manual `overflow: hidden` +
 * `paddingRight` compensation causes layout jitter).
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
        const position = SIDE_POSITION[side];
        const dimStyle =
            dims.dim === "width" ? `width:${dimValue};max-width:90vw;` : `height:${dimValue};max-height:85vh;`;

        // Transform + transition are managed by base.css (.cs-sheet__panel +
        // side variant). Inline style only carries position + dimensions.
        const panelStyle = `${position};${dimStyle}`;

        const panelClasses = classMap({
            "cs-sheet__panel": true,
            [`cs-sheet--${side}`]: true,
            "fixed bg-popover text-popover-foreground shadow-lg border flex flex-col z-[100]": true,
            "border-r": side === "left",
            "border-l": side === "right",
            "border-b": side === "top",
            "border-t": side === "bottom",
        });

        return html`
            <dialog
                ref=${this.dialogRef}
                class="cs-sheet"
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
