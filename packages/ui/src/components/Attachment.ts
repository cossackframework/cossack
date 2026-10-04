import { html, classMap, component, PreventDefaultResult, preventDefault } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";
import type { GlobalAttributes, ButtonAttributes, AriaAttributes, ControlEvent } from "../native-attributes";
import { Icon } from "../icons/Icon";
import { CloseCircleIcon as closeCircleIcon } from "@cossackframework/solar-icons/close-circle";

export type AttachmentType = "file" | "image" | "audio" | "video" | "archive" | "code";
export type AttachmentStatusVariant = "neutral" | "success" | "error";
/** Native removal button. The component owns its action type and accessible name. */
export type AttachmentRemoveProps = Omit<ButtonAttributes,
    'type' | 'role' | 'aria-label' | 'aria-labelledby' | 'popovertarget' | 'popovertargetaction' |
    'formaction' | 'formenctype' | 'formmethod' | 'formnovalidate' | '?formnovalidate' | 'formtarget'>;
/** Decorative preview; thumbnail owns src, and the filename supplies its alternative. */
export type AttachmentThumbnailProps = Omit<GlobalAttributes<HTMLImageElement>,
    keyof AriaAttributes | 'role' | 'tabindex' | 'autofocus' | '?autofocus' | 'contenteditable'> & {
    loading?: 'eager' | 'lazy';
    decoding?: 'sync' | 'async' | 'auto';
    referrerpolicy?: ReferrerPolicy;
};
export type AttachmentProps = GlobalAttributes<HTMLDivElement> & {
    /** Required file name, also used in the default removal label. */
    name: string;
    /** Human-readable size; the caller owns units and localization. */
    size?: string;
    /** Icon variant; inferred from the filename extension when omitted. */
    type?: AttachmentType;
    thumbnail?: string;
    thumbnailProps?: AttachmentThumbnailProps;
    /** Plain status text. Its words never select colors or announce automatically. */
    status?: string;
    statusVariant?: AttachmentStatusVariant;
    /** Localized name for the removal action. Defaults to `Remove ${name}`. */
    removeLabel?: string;
    removeProps?: AttachmentRemoveProps;
    /** Synchronous native event target; the owning list handles removal and focus. */
    onRemove?: (event: ControlEvent<HTMLButtonElement, PointerEvent>) => unknown;
};

const TYPE_ICONS: Record<string, AttachmentType> = {
    pdf: "file", doc: "file", docx: "file", txt: "file",
    jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", svg: "image",
    mp3: "audio", wav: "audio", ogg: "audio",
    mp4: "video", mov: "video", avi: "video", webm: "video",
    zip: "archive", rar: "archive", gz: "archive", "7z": "archive",
    js: "code", ts: "code", json: "code", html: "code", css: "code", py: "code",
};
function detectType(name: string): AttachmentType {
    const dot = name.lastIndexOf('.');
    const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
    return Object.hasOwn(TYPE_ICONS, extension) ? TYPE_ICONS[extension] : 'file';
}

/** A named file card with an optional native removal action and decorative preview. */
@Component()
export class Attachment extends Cossack {
    declare props: AttachmentProps;

    render() {
        const { name, size, type, thumbnail, thumbnailProps, status, statusVariant = 'neutral',
            removeLabel = `Remove ${name}`, removeProps, onRemove, ...rest } = this.props;
        if (typeof name !== 'string' || !name.trim()) throw new Error('Attachment requires a nonempty filename.');
        if (typeof removeLabel !== 'string' || !removeLabel.trim()) throw new Error('Attachment removeLabel must be nonempty.');
        for (const [key, value] of Object.entries({ size, status, thumbnail })) {
            if (value !== undefined && typeof value !== 'string') throw new Error(`Attachment ${key} must be a string.`);
        }
        if (type !== undefined && !['file', 'image', 'audio', 'video', 'archive', 'code'].includes(type)) throw new Error('Attachment type is unsupported.');
        if (!['neutral', 'success', 'error'].includes(statusVariant)) throw new Error('Attachment statusVariant must be neutral, success or error.');
        if (onRemove !== undefined && typeof onRemove !== 'function') throw new Error('Attachment onRemove must be a function.');
        if (this.children != null && this.children !== false && this.children !== '') throw new Error('Attachment does not accept component children.');
        const resolvedType = type ?? detectType(name);
        const supplied = removeProps?.['@click'];
        const click: EventListener = event => {
            const nativeEvent = event as ControlEvent<HTMLButtonElement, PointerEvent>;
            if (nativeEvent.currentTarget.matches(':disabled')) return;
            if (typeof supplied === 'function') supplied(nativeEvent);
            else if (supplied instanceof PreventDefaultResult) supplied.handler.call(event.currentTarget, event);
            if (!event.defaultPrevented && !nativeEvent.currentTarget.matches(':disabled')) onRemove?.(nativeEvent);
        };
        const buttonProps = { ...removeProps, '@click': supplied instanceof PreventDefaultResult
            ? preventDefault(click, { novalidate: supplied.novalidate }) : click };

        return html`
            <div class="cs-attachment flex items-center gap-3 rounded-lg border bg-card text-card-foreground p-3 w-full min-w-0 max-w-sm" ...=${rest}>
                ${thumbnail
                    ? html`<img class="cs-attachment__thumb w-10 h-10 rounded-md object-cover shrink-0" ...=${thumbnailProps} src=${thumbnail} alt="" aria-hidden="true" />`
                    : html`<div aria-hidden="true" data-file-type=${resolvedType} class="cs-attachment__icon w-10 h-10 rounded-md bg-muted inline-flex items-center justify-center shrink-0 text-muted-foreground [&_svg]:size-5">
                          ${this.renderTypeIcon(resolvedType)}
                      </div>`}
                <div class="cs-attachment__info flex-1 min-w-0">
                    <div class="cs-attachment__name text-sm font-medium text-foreground truncate" title=${name}>${name}</div>
                    <div class="flex flex-wrap items-center gap-2 min-w-0">
                        ${size ? html`<span class="text-xs text-muted-foreground [overflow-wrap:anywhere]">${size}</span>` : null}
                        ${status ? html`<span class=${classMap({
                            "cs-attachment__status text-xs px-1.5 py-0.5 rounded min-w-0 [overflow-wrap:anywhere]": true,
                            "text-success bg-success/10": statusVariant === 'success',
                            "text-destructive bg-destructive/10": statusVariant === 'error',
                            "text-muted-foreground bg-muted": statusVariant === 'neutral',
                        })}>${status}</span>` : null}
                    </div>
                </div>
                ${onRemove
                    ? html`<button
                          class="cs-attachment__remove size-7 inline-flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer border-none bg-transparent text-muted-foreground shrink-0 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] [&_svg]:size-4 transition-colors motion-reduce:transition-none disabled:opacity-50 disabled:cursor-not-allowed"
                          ...=${buttonProps} type="button" aria-label=${removeLabel}
                      ><span aria-hidden="true">${component(Icon, { entry: closeCircleIcon, size: 14 })}</span></button>`
                    : null}
            </div>
        `;
    }

    private renderTypeIcon(t: string) {
        const c = "w-5 h-5";
        switch (t) {
            case "image":
                return html`<svg class=${c} viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="9" r="2" stroke="currentColor" stroke-width="1.5"/><path d="M21 15l-5-5L5 21" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
            case "audio":
                return html`<svg class=${c} viewBox="0 0 24 24" fill="none"><path d="M9 18V5l12-2v13" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="1.5"/></svg>`;
            case "video":
                return html`<svg class=${c} viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M10 9l5 3-5 3V9z" fill="currentColor"/></svg>`;
            case "archive":
                return html`<svg class=${c} viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8" stroke="currentColor" stroke-width="1.5"/><path d="M10 12h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
            case "code":
                return html`<svg class=${c} viewBox="0 0 24 24" fill="none"><path d="M8 9l-3 3 3 3M16 9l3 3-3 3M14 5l-4 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            default:
                return html`<svg class=${c} viewBox="0 0 24 24" fill="none"><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M14 3v6h6" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
        }
    }
}
