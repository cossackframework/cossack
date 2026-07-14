import { html } from "@cossackframework/renderer";
import { Cossack, Component, ClientState, Client } from "@cossackframework/core";

export interface ResizableProps {
    /** Initial size of the first panel as a percentage (0-100). Default 50. */
    defaultSize?: number;
    /** Minimum size of either panel as a percentage. Default 10. */
    minSize?: number;
    /** Layout direction. */
    orientation?: "horizontal" | "vertical";
    [key: string]: any;
}

/**
 * Cossack UI Resizable — two-panel resizable splitter.
 *
 * Pass exactly two children (first = primary panel, second = secondary panel).
 * A visible drag handle between them adjusts the split. Uses mouse events.
 *
 *   ${component(Resizable, { defaultSize: 30 },
 *       html\`<div>Left</div><div>Right</div>\`)}
 */
@Component()
export class Resizable extends Cossack {
    declare props: ResizableProps;

    @ClientState() sizePct: number = 50;

    render() {
        const { defaultSize = 50, minSize = 10, orientation = "horizontal" } = this.props;
        if (this.sizePct === 50 && defaultSize !== 50) this.sizePct = defaultSize;
        const isVertical = orientation === "vertical";

        return html`
            <div
                class="cs-resizable w-full ${isVertical ? 'flex flex-col' : 'flex flex-row'}"
                style="height: 100%;"
            >
                <div
                    class="cs-resizable__panel cs-resizable__panel--first overflow-auto"
                    style=${isVertical
                        ? `height:${this.sizePct}%;flex-shrink:0;`
                        : `width:${this.sizePct}%;flex-shrink:0;`}
                >
                    ${Array.isArray(this.children) ? this.children[0] : this.children}
                </div>
                <div
                    class=${isVertical
                        ? "cs-resizable__handle cursor-row-resize h-1.5 w-full bg-border hover:bg-primary flex-shrink-0 transition-colors relative group"
                        : "cs-resizable__handle cursor-col-resize w-1.5 h-full bg-border hover:bg-primary flex-shrink-0 transition-colors relative group"}
                    @mousedown=${(e: MouseEvent) => this.startDrag(e)}
                >
                    <div class="absolute inset-0 group-hover:bg-primary/20 rounded transition-colors"></div>
                </div>
                <div
                    class="cs-resizable__panel cs-resizable__panel--second overflow-auto"
                    style="flex: 1; min-width: 0;"
                >
                    ${Array.isArray(this.children) ? this.children[1] : null}
                </div>
            </div>
        `;
    }

    @Client()
    startDrag(e: MouseEvent) {
        e.preventDefault();
        const isVertical = this.props.orientation === "vertical";
        const container = (e.currentTarget as HTMLElement).parentElement;
        if (!container) return;
        const minPct = this.props.minSize ?? 10;
        const startPos = isVertical ? e.clientY : e.clientX;
        const containerSize = isVertical ? container.offsetHeight : container.offsetWidth;
        const startPct = this.sizePct;

        const onMove = (ev: MouseEvent) => {
            const currentPos = isVertical ? ev.clientY : ev.clientX;
            const deltaPct = ((currentPos - startPos) / containerSize) * 100;
            let newPct = startPct + deltaPct;
            newPct = Math.max(minPct, Math.min(100 - minPct, newPct));
            this.sizePct = newPct;
        };

        const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        document.body.style.cursor = isVertical ? "row-resize" : "col-resize";
        document.body.style.userSelect = "none";
    }
}
