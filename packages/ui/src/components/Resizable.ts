import { html, IfDefinedResult } from '@cossackframework/renderer';
import { Cossack, Component, ClientState, Client } from '@cossackframework/core';
import type { GlobalAttributes } from '../native-attributes';
import { ControlledValue } from '../native-attributes';

export type ResizablePanelProps = Omit<GlobalAttributes<HTMLDivElement>, 'id' | 'hidden' | '?hidden' | 'inert' | '?inert' | 'aria-hidden'>;
export type ResizableHandleProps = Omit<GlobalAttributes<HTMLDivElement>,
    'id' | 'role' | 'tabindex' | 'aria-label' | 'aria-labelledby' | 'aria-controls' |
    'aria-orientation' | 'aria-valuemin' | 'aria-valuemax' | 'aria-valuenow' | 'aria-disabled' |
    '@keydown' | '@pointerdown' | '@pointermove' | '@pointerup' | '@pointercancel' | '@lostpointercapture'>;
export type ResizableProps = Omit<GlobalAttributes<HTMLDivElement>, 'id'> & {
    /** Stable, document-unique ID; panel and handle IDs derive from it. */
    id: string;
    /** Name shared by the primary panel and adjustable separator. */
    label: string;
    primary: unknown;
    secondary: unknown;
    primaryProps?: Omit<ResizablePanelProps, 'role' | 'aria-label' | 'aria-labelledby'>;
    secondaryProps?: ResizablePanelProps;
    handleProps?: ResizableHandleProps;
    /** Controlled primary-panel percentage of space left after the handle. */
    size?: number;
    /** Captured once. Defaults to 50, clamped to the current bounds. */
    defaultSize?: number;
    /** Minimum percentage for each panel, from 0 to 50. Defaults to 10. */
    minSize?: number;
    /** Panel layout direction; the separator's ARIA orientation is perpendicular. */
    orientation?: 'horizontal' | 'vertical';
    /** Arrow-key percentage step. Shift multiplies it by ten. Defaults to 1. */
    step?: number;
    disabled?: boolean;
    /** Proposes a clamped percentage. Controlled callers must update size. */
    onSizeChange?: (size: number) => unknown;
};

type DragSession = {
    handle: HTMLDivElement; pointerId: number; start: number; size: number;
    available: number; sign: number; orientation: 'horizontal' | 'vertical';
    minSize: number; id: string; stopBlur: () => void;
};

/** Two explicit panels with a keyboard- and pointer-operated native separator.
 * Give the root a usable height. Native root, panel and handle props have separate targets.
 */
@Component()
export class Resizable extends Cossack {
    declare props: ResizableProps;
    @ClientState() private localSize: number | undefined;
    private initialSize?: number;
    private restoreSize?: number;
    private rootElement?: HTMLDivElement;
    private handleElement?: HTMLDivElement;
    private dragSession?: DragSession;
    private controlled = new ControlledValue<number>();

    private bounds() { return this.props.minSize === undefined ? 10 : this.props.minSize; }
    private clampSize(value: number) { return Math.max(this.bounds(), Math.min(100 - this.bounds(), value)); }
    private currentSize() {
        this.initialSize ??= this.props.defaultSize ?? 50;
        return this.clampSize(this.props.size ?? this.localSize ?? this.initialSize);
    }
    private validate() {
        const p = this.props;
        if (typeof p.id !== 'string' || !p.id || /\s/.test(p.id)) throw new Error('Resizable requires a nonempty id without whitespace.');
        if (typeof p.label !== 'string' || !p.label.trim()) throw new Error('Resizable requires a nonempty label.');
        if (!Object.hasOwn(p, 'primary') || !Object.hasOwn(p, 'secondary')) throw new Error('Resizable requires explicit primary and secondary panels.');
        if (this.children != null && this.children !== false && this.children !== '') throw new Error('Resizable uses primary and secondary props, not children.');
        for (const name of ['size', 'defaultSize'] as const) {
            const value = p[name];
            if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)) throw new Error(`Resizable ${name} must be a finite percentage from 0 to 100.`);
        }
        const min = this.bounds(), step = p.step === undefined ? 1 : p.step;
        if (typeof min !== 'number' || !Number.isFinite(min) || min < 0 || min > 50) throw new Error('Resizable minSize must be from 0 to 50.');
        if (typeof step !== 'number' || !Number.isFinite(step) || step <= 0 || step > 100) throw new Error('Resizable step must be greater than 0 and at most 100.');
        if (p.orientation !== undefined && p.orientation !== 'horizontal' && p.orientation !== 'vertical') throw new Error('Resizable orientation must be horizontal or vertical.');
        if (p.disabled !== undefined && typeof p.disabled !== 'boolean') throw new Error('Resizable disabled must be boolean.');
        if (p.onSizeChange !== undefined && typeof p.onSizeChange !== 'function') throw new Error('Resizable onSizeChange must be a function.');
    }

    render() {
        this.validate();
        const { id, label, primary, secondary, primaryProps, secondaryProps, handleProps,
            orientation = 'horizontal', disabled = false, style,
            size: _size, defaultSize: _default, minSize: _min, step: _step, onSizeChange: _change, ...rest } = this.props;
        const value = this.currentSize(), min = this.bounds(), vertical = orientation === 'vertical';
        const inactive = disabled || min === 50;
        const drag = this.dragSession;
        if (drag && (inactive || drag.orientation !== orientation || drag.minSize !== min || drag.id !== id)) this.endDrag();
        const focused = this.rootElement?.ownerDocument.activeElement;
        if (focused && ((value === 0 && this.rootElement?.querySelector(':scope > .cs-resizable__panel--first')?.contains(focused)) ||
            (value === 100 && this.rootElement?.querySelector(':scope > .cs-resizable__panel--second')?.contains(focused)))) this.handleElement?.focus();
        const suppliedStyle = style instanceof IfDefinedResult ? style.value : style;
        const tracks = `minmax(0, ${value}fr) 6px minmax(0, ${100 - value}fr)`;
        const layout = `height:100%;display:grid;grid-template-columns:${vertical ? 'minmax(0, 1fr)' : tracks};grid-template-rows:${vertical ? tracks : 'minmax(0, 1fr)'};${typeof suppliedStyle === 'string' ? suppliedStyle : ''}`;
        return html`<div id=${id} class="cs-resizable w-full min-w-0 min-h-0" style=${layout} ...=${rest} ref=${(el: Element) => { this.rootElement = el as HTMLDivElement; }}>
            <div ...=${primaryProps} id=${`${id}-primary`} class="cs-resizable__panel cs-resizable__panel--first min-w-0 min-h-0 overflow-auto" role="group" aria-label=${label} ?inert=${value === 0} aria-hidden=${value === 0 ? 'true' : 'false'}>${primary}</div>
            <div ...=${handleProps} id=${`${id}-handle`} ref=${(el: Element) => { this.handleElement = el as HTMLDivElement; }}
                class=${`cs-resizable__handle bg-border hover:bg-primary focus-visible:outline-2 focus-visible:outline-ring transition-colors motion-reduce:transition-none touch-none select-none ${inactive ? 'cursor-default' : vertical ? 'cursor-row-resize' : 'cursor-col-resize'}`}
                role="separator" tabindex=${inactive ? -1 : 0} aria-label=${label} aria-controls=${`${id}-primary`}
                aria-orientation=${vertical ? 'horizontal' : 'vertical'} aria-valuemin=${min} aria-valuemax=${100 - min} aria-valuenow=${value} aria-disabled=${inactive ? 'true' : 'false'}
                @keydown=${(event: KeyboardEvent) => this.keyResize(event)} @pointerdown=${(event: PointerEvent) => this.startDrag(event)}
                @pointermove=${(event: PointerEvent) => this.moveDrag(event)} @pointerup=${(event: PointerEvent) => this.finishPointer(event)}
                @pointercancel=${(event: PointerEvent) => this.finishPointer(event)} @lostpointercapture=${(event: PointerEvent) => this.finishPointer(event)}></div>
            <div ...=${secondaryProps} id=${`${id}-secondary`} class="cs-resizable__panel cs-resizable__panel--second min-w-0 min-h-0 overflow-auto" ?inert=${value === 100} aria-hidden=${value === 100 ? 'true' : 'false'}>${secondary}</div>
        </div>`;
    }

    /** Size the next keyboard edit builds on, including a proposal the parent has not rendered yet. */
    private baseSize() { return this.controlled.base(this.props, this.currentSize()); }
    @Client()
    private propose(value: number) {
        if (this.props.disabled || this.bounds() === 50) return;
        const next = this.clampSize(value);
        if (!Number.isFinite(next) || !this.controlled.changed(this.props, this.currentSize(), next)) return;
        if (this.props.size === undefined) this.localSize = next;
        this.props.onSizeChange?.(this.controlled.emit(this.props, next));
    }
    @Client()
    private keyResize(event: KeyboardEvent) {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || this.props.disabled || this.bounds() === 50) return;
        const vertical = this.props.orientation === 'vertical';
        const rtl = !vertical && this.rootElement?.ownerDocument.defaultView?.getComputedStyle(this.rootElement).direction === 'rtl';
        const current = this.baseSize(), step = (this.props.step ?? 1) * (event.shiftKey ? 10 : 1);
        let next: number;
        if (event.key === 'Home') next = this.bounds();
        else if (event.key === 'End') next = 100 - this.bounds();
        else if (event.key === 'Enter') {
            if (current > this.bounds()) { this.restoreSize = current; next = this.bounds(); }
            else {
                const restored = this.restoreSize ?? this.initialSize ?? 50;
                next = restored > this.bounds() ? restored : 50;
            }
        } else if (event.key === (vertical ? 'ArrowDown' : 'ArrowRight')) next = current + step * (rtl ? -1 : 1);
        else if (event.key === (vertical ? 'ArrowUp' : 'ArrowLeft')) next = current - step * (rtl ? -1 : 1);
        else return;
        event.preventDefault(); this.endDrag(); this.propose(next);
    }
    @Client()
    private startDrag(event: PointerEvent) {
        if (event.defaultPrevented || event.button !== 0 || !event.isPrimary || this.props.disabled || this.bounds() === 50 || this.dragSession) return;
        const handle = this.handleElement, root = this.rootElement;
        if (!handle || !root) return;
        const orientation = this.props.orientation ?? 'horizontal', vertical = orientation === 'vertical';
        // Sum the two actual panel tracks: excludes the handle, border and padding.
        const first = root.querySelector(':scope > .cs-resizable__panel--first')?.getBoundingClientRect();
        const second = root.querySelector(':scope > .cs-resizable__panel--second')?.getBoundingClientRect();
        if (!first || !second) return;
        const available = vertical ? first.height + second.height : first.width + second.width;
        if (!Number.isFinite(available) || available <= 0) return;
        try { handle.setPointerCapture(event.pointerId); } catch { return; }
        event.preventDefault(); handle.focus();
        const view = handle.ownerDocument.defaultView;
        const blur = () => this.endDrag();
        view?.addEventListener('blur', blur);
        this.dragSession = { handle, pointerId: event.pointerId, start: vertical ? event.clientY : event.clientX,
            size: this.baseSize(), available, orientation, minSize: this.bounds(), id: this.props.id,
            sign: !vertical && view?.getComputedStyle(root).direction === 'rtl' ? -1 : 1,
            stopBlur: () => view?.removeEventListener('blur', blur) };
    }
    @Client()
    private moveDrag(event: PointerEvent) {
        const drag = this.dragSession;
        if (!drag || event.pointerId !== drag.pointerId) return;
        const root = this.rootElement;
        const sign = drag.orientation === 'horizontal' && root?.ownerDocument.defaultView?.getComputedStyle(root).direction === 'rtl' ? -1 : 1;
        if (sign !== drag.sign) { this.endDrag(); return; }
        if (event.pointerType === 'mouse' && event.buttons === 0) { this.endDrag(); return; }
        const position = drag.orientation === 'vertical' ? event.clientY : event.clientX;
        try { this.propose(drag.size + (position - drag.start) / drag.available * 100 * drag.sign); }
        catch (error) { this.endDrag(); throw error; }
    }
    @Client()
    private finishPointer(event: PointerEvent) {
        if (event.pointerId === this.dragSession?.pointerId) this.endDrag();
    }
    @Client()
    private endDrag() {
        const drag = this.dragSession;
        if (!drag) return;
        this.dragSession = undefined; drag.stopBlur();
        try { if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId); } catch { /* The pointer may already have ended. */ }
    }
    onCleanup() { this.endDrag(); this.rootElement = undefined; this.handleElement = undefined; }
}
