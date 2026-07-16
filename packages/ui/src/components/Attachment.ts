import { html, classMap, component } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";
import { Icon } from "../icons/Icon";
import { CloseCircleIcon as closeCircleIcon } from "@cossackframework/solar-icons/close-circle";

export interface AttachmentProps {
    /** File name. */
    name?: string;
    /** Human-readable file size (e.g. "2.4 MB"). */
    size?: string;
    /** File type icon variant. Auto-detected from `name` extension if omitted. */
    type?: "file" | "image" | "audio" | "video" | "archive" | "code";
    /** Optional thumbnail/image URL (shown instead of the type icon). */
    thumbnail?: string;
    /** Optional status badge text (e.g. "Uploaded", "Failed"). */
    status?: string;
    /** Called when the remove button is clicked. */
    onRemove?: () => void;
    [key: string]: any;
}

const TYPE_ICONS: Record<string, string> = {
    pdf: "file",
    doc: "file", docx: "file", txt: "file",
    jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", svg: "image",
    mp3: "audio", wav: "audio", ogg: "audio",
    mp4: "video", mov: "video", avi: "video", webm: "video",
    zip: "archive", rar: "archive", gz: "archive", "7z": "archive",
    js: "code", ts: "code", json: "code", html: "code", css: "code", py: "code",
};

function detectType(name?: string): NonNullable<AttachmentProps["type"]> {
    if (!name) return "file";
    const ext = name.split(".").pop()?.toLowerCase() || "";
    return (TYPE_ICONS[ext] as NonNullable<AttachmentProps["type"]>) || "file";
}

/**
 * Cossack UI Attachment — chat file-attachment card.
 *
 * Shows a file with its icon/thumbnail, name, size, and optional remove button.
 * The icon variant is auto-detected from the file extension when `type` is
 * omitted.
 *
 *   ${component(Attachment, { name: 'report.pdf', size: '2.4 MB', onRemove: () => {} })}
 */
@Component()
export class Attachment extends Cossack {
    declare props: AttachmentProps;

    render() {
        const { name = "file", size, type, thumbnail, status, onRemove } = this.props;
        const resolvedType = type || detectType(name);

        return html`
            <div class="cs-attachment flex items-center gap-3 rounded-lg border bg-card text-card-foreground p-3 max-w-sm">
                <!-- Thumbnail or type icon -->
                ${thumbnail
                    ? html`<img src=${thumbnail} alt="" class="cs-attachment__thumb w-10 h-10 rounded-md object-cover shrink-0" />`
                    : html`<div class="cs-attachment__icon w-10 h-10 rounded-md bg-muted inline-flex items-center justify-center shrink-0 text-muted-foreground [&_svg]:size-5">
                          ${this.renderTypeIcon(resolvedType)}
                      </div>`}
                <!-- Name + size + status -->
                <div class="cs-attachment__info flex-1 min-w-0">
                    <div class="text-sm font-medium text-foreground truncate">${name}</div>
                    <div class="flex items-center gap-2">
                        ${size ? html`<span class="text-xs text-muted-foreground">${size}</span>` : null}
                        ${status ? html`<span class=${classMap({
                            "text-xs px-1.5 py-0.5 rounded": true,
                            "text-success bg-success/10": status.toLowerCase().includes("upload") || status.toLowerCase().includes("done"),
                            "text-destructive bg-destructive/10": status.toLowerCase().includes("fail") || status.toLowerCase().includes("error"),
                            "text-muted-foreground bg-muted": !(
                                status.toLowerCase().includes("upload") ||
                                status.toLowerCase().includes("done") ||
                                status.toLowerCase().includes("fail") ||
                                status.toLowerCase().includes("error")
                            ),
                        })}>${status}</span>` : null}
                    </div>
                </div>
                <!-- Remove button -->
                ${onRemove
                    ? html`<button
                          type="button"
                          class="cs-attachment__remove size-7 inline-flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer border-none bg-transparent text-muted-foreground shrink-0 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] [&_svg]:size-4 transition-colors"
                          aria-label="Remove attachment"
                          @click=${() => onRemove()}
                      >
                          ${component(Icon, { entry: closeCircleIcon, size: 14 })}
                      </button>`
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
