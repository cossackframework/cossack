import { html, classMap } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    Client,
    Task,
    ClientState,
    createRef,
    type RefObject,
} from "@cossackframework/core";

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

const SIDE_ENTER: Record<string, string> = {
    left: "translateX(-100%)",
    right: "translateX(100%)",
    top: "translateY(-100%)",
    bottom: "translateY(100%)",
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
        const enter = SIDE_ENTER[side];

        const panelClasses = classMap({
            "cs-drawer__panel": true,
            [`cs-drawer--${side}`]: true,
            "fixed bg-background text-foreground shadow-2xl flex flex-col z-[100]": true,
            // Rounded corners away from the attached edge.
            "rounded-t-2xl": side === "bottom",
            "rounded-b-2xl": side === "top",
            "rounded-r-2xl": side === "left",
            "rounded-l-2xl": side === "right",
        });

        // The slide uses inline transform + @starting-style for the enter.
        const panelStyle =
            `${position};${dimStyle}transform:translateX(0);` +
            `transition:transform 300ms cubic-bezier(0.32,0.72,0,1);`;

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
                                  ? html`<span class="text-sm font-medium text-foreground px-4">${title}</span>`
                                  : null}
                          </div>`
                        : showTitle
                            ? html`<div class="cs-drawer__header px-4 py-3 border-b border-border flex items-center justify-between">
                                  <span class="text-sm font-semibold text-foreground">${title}</span>
                                  <button
                                      type="button"
                                      class="cs-drawer__close w-7 h-7 inline-flex items-center justify-center rounded-md hover:bg-muted cursor-pointer border-none bg-transparent text-muted-foreground"
                                      aria-label="Close"
                                      @click=${() => this.close()}
                                  >
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                                  </button>
                              </div>`
                            : null}
                    <div class="cs-drawer__body flex-1 overflow-y-auto px-4 py-3">
                        ${this.children}
                    </div>
                </div>
            </dialog>
            <style>
                .cs-drawer__panel {
                    will-change: transform;
                }
                @starting-style {
                    .cs-drawer__panel {
                        transform: ${enter};
                    }
                }
                .cs-drawer[open]::backdrop {
                    background-color: rgb(0 0 0 / 0.4);
                    animation: cs-drawer-fade 200ms ease-out;
                }
                @keyframes cs-drawer-fade {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
            </style>
        `;
    }

    @Client()
    close() {
        const dlg = this.dialogRef.value;
        if (dlg && dlg.open) dlg.close();
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
