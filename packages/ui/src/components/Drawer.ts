import { html, classMap, component } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    Client,
    ClientTask,
    ClientState,
    createRef,
    type RefObject,
} from "@cossackframework/core";
import { Icon } from "../icons/Icon";
import { CloseCircleIcon as closeCircleIcon } from "@cossackframework/solar-icons/close-circle";

export interface DrawerProps {
    /** Controlled open state. */
    open?: boolean;
    /** Which edge the drawer slides from. Default "right". */
    side?: "top" | "bottom" | "left" | "right";
    /** Panel size (CSS length). Default "380px" (width) or "auto" (height). */
    size?: string;
    /** Close when backdrop is clicked. Default true. */
    closeOnBackdrop?: boolean;
    /** Called when the drawer closes. */
    onClose?: () => void;
    /** Optional title shown in the header handle area. */
    title?: string;
    [key: string]: any;
}

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

/**
 * Cossack UI Drawer — slide-in panel built on native `<dialog>`.
 *
 * Similar to Sheet, but styled for a "drawer" feel: rounded top corners (when
 * bottom-side), a drag handle grip in the header, and a visible backdrop.
 * Built on `dialog.showModal()` for top-layer rendering, focus management, and
 * ESC dismiss. No body overflow manipulation — the top layer handles it.
 *
 *   ${component(Drawer, {
 *       open: this.drawerOpen,
 *       side: 'right',
 *       title: 'Filters',
 *       onClose: () => { this.drawerOpen = false; },
 *   }, html\`<p>Drawer body</p>\`)}
 */
@Component()
export class Drawer extends Cossack {
    declare props: DrawerProps;

    dialogRef: RefObject<HTMLDialogElement> = createRef<HTMLDialogElement>();
    @ClientState() private mounted = false;

    render() {
        const {
            open: _open,
            side = "right",
            size,
            closeOnBackdrop = true,
            title,
            ...rest
        } = this.props;

        const dims = SIDE_DIM[side];
        const dimValue = size || dims.val;
        const dimStyle =
            dims.dim === "width"
                ? `width:${dimValue};max-width:90vw;`
                : `max-height:85vh;`;
        const position = SIDE_POS[side];

        const panelClasses = classMap({
            "cs-drawer__panel": true,
            [`cs-drawer--${side}`]: true,
            "fixed bg-popover text-popover-foreground shadow-lg flex flex-col z-[100]": true,
            // Rounded corners away from the attached edge.
            "rounded-t-2xl": side === "bottom",
            "rounded-b-2xl": side === "top",
            "rounded-r-2xl": side === "left",
            "rounded-l-2xl": side === "right",
        });

        // The panel transform is managed by base.css (.cs-drawer__panel + side
        // variant). Inline style only carries position + dimensions.
        const panelStyle = `${position};${dimStyle}`;

        const showHandle = side === "top" || side === "bottom";
        const showTitle = !!title;

        return html`
            <dialog
                ref=${this.dialogRef}
                class="cs-drawer"
                style="background:transparent;border:none;padding:0;margin:0;max-width:100vw;max-height:100vh;"
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
                <div
                    class=${panelClasses}
                    style=${panelStyle}
                    ...=${rest}
                >
                    ${showHandle
                        ? html`<div class="cs-drawer__handle pt-3 pb-2 flex flex-col items-center gap-2 cursor-grab">
                              <span class="block w-10 h-1.5 rounded-full bg-muted-foreground/30"></span>
                              ${showTitle
                                  ? html`<span class="text-sm font-medium text-popover-foreground px-4">${title}</span>`
                                  : null}
                          </div>`
                        : showTitle
                            ? html`<div class="cs-drawer__header px-4 py-3 border-b flex items-center justify-between">
                                  <span class="text-sm font-semibold text-popover-foreground">${title}</span>
                                  <button
                                      type="button"
                                      class="cs-drawer__close size-7 inline-flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer border-none bg-transparent text-muted-foreground outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] [&_svg]:size-4 transition-colors"
                                      aria-label="Close"
                                      @click=${() => this.close()}
                                  >
                                      ${component(Icon, { entry: closeCircleIcon, size: 16 })}
                                  </button>
                              </div>`
                            : null}
                    <div class="cs-drawer__body flex-1 overflow-y-auto px-4 py-3">
                        ${this.children}
                    </div>
                </div>
            </dialog>
        `;
    }

    @Client()
    close() {
        const dlg = this.dialogRef.value;
        if (dlg && dlg.open) dlg.close();
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
