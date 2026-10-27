import { html, type TemplateResult } from "@cossackframework/renderer";
import { Client, ClientState, Component, Cossack } from "@cossackframework/core";
import type { IconEntry, IconStyle } from "@cossackframework/solar-icons/types";
import { Icon } from "../icons/Icon";
import { Popover } from "./Popover";
import { component } from "@cossackframework/renderer";

/** Icons the picker offers, by name; or a loader for them, called the first time the picker opens. */
export type IconPickerSource = Readonly<Record<string, IconEntry>> | (() => Promise<Readonly<Record<string, IconEntry>>>);

export type IconPickerProps = {
    /** Stable, page-unique ID; the popover's is `${id}-picker`. */
    id: string;
    /** The chosen icon's name, or empty. */
    value: string;
    icons: IconPickerSource;
    /** The style drawn, when the entries have it. Default `line`. */
    style?: IconStyle;
    /** Spoken name of the control. Default "Icon". */
    label?: string;
    /** Offer a "None" choice. Default true. */
    allowEmpty?: boolean;
    disabled?: boolean;
    onChange?(name: string): void;
};

const PAGE = 120;

/**
 * Cossack UI IconPicker — a button showing the chosen icon that opens a searchable grid of
 * icons. Give it the icons you ship (a map of name to entry) so bundles stay small, or a
 * loader for a larger set, such as `() => import('@cossackframework/solar-icons/registry')
 * .then(m => m.iconRegistry)`, which downloads only when someone opens the picker.
 *
 *   <${IconPicker} id="icon" .value=${name} .icons=${ICONS} .onChange=${name => (this.icon = name)} />
 */
@Component()
export class IconPicker extends Cossack {
    declare props: IconPickerProps;
    @ClientState() private search = "";
    @ClientState() private loaded: Readonly<Record<string, IconEntry>> | null = null;
    @ClientState() private busy = false;
    @ClientState() private failed = false;
    @ClientState() private shown = PAGE;

    private get available(): Readonly<Record<string, IconEntry>> | null {
        return typeof this.props.icons === "function" ? this.loaded : this.props.icons;
    }

    @Client()
    private async load() {
        if (this.available || this.busy || typeof this.props.icons !== "function") return;
        this.busy = true;
        try { this.loaded = await this.props.icons(); }
        catch (error) { console.error("[ui] the icons could not load", error); this.failed = true; }
        finally { this.busy = false; }
    }

    @Client()
    private pick(name: string) {
        const panel = document.getElementById(`${this.props.id}-picker-content`);
        if (panel && typeof panel.hidePopover === "function") panel.hidePopover();
        this.search = "";
        this.shown = PAGE;
        this.props.onChange?.(name);
    }

    @Client()
    private query(value: string) {
        this.search = value;
        this.shown = PAGE;
    }

    render(): TemplateResult {
        const { id, value, label = "Icon", allowEmpty = true, style = "line" } = this.props;
        const icons = this.available;
        const current = icons?.[value];
        const query = this.search.trim().toLowerCase().replace(/\s+/g, "-");
        const names = icons ? Object.keys(icons).filter(name => !query || name.includes(query)) : [];
        const cell = "flex aspect-square w-full items-center justify-center rounded-md border-none bg-transparent text-foreground cursor-pointer hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-5";
        return component(Popover, {
            id: `${id}-picker`, side: "bottom", align: "start", "?disabled": Boolean(this.props.disabled),
            class: "cs-icon-picker inline-flex h-9 min-w-9 items-center gap-2 rounded-md border border-input bg-background px-2 text-sm text-foreground shadow-xs hover:bg-muted",
            "aria-label": label, title: value || label,
            trigger: html`<span class="inline-flex [&_svg]:size-4" aria-hidden="true">${current ? component(Icon, { entry: current, size: 16, variant: style }) : html`<span class="text-muted-foreground">—</span>`}</span><span class="max-w-40 truncate">${value || "None"}</span>`,
            contentProps: { role: "dialog", "aria-label": label, class: "w-80 max-w-[calc(100vw-2rem)] space-y-2", "@toggle": (event: Event) => { if ((event as ToggleEvent).newState === "open") void this.load(); } },
        }, html`
            <input type="search" aria-label=${`Search ${label.toLowerCase()}s`} placeholder="Search" .value=${this.search}
                class="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                @input=${(event: Event) => this.query((event.target as HTMLInputElement).value)}>
            <div class="max-h-72 overflow-y-auto">
                ${this.failed ? html`<p role="alert" class="py-4 text-center text-sm text-destructive">The icons could not load.</p>`
                : !icons ? html`<p class="py-4 text-center text-sm text-muted-foreground">Loading icons…</p>`
                : html`<ul class="grid grid-cols-6 gap-1" role="listbox" aria-label=${label}>
                    ${allowEmpty && !query ? html`<li><button type="button" role="option" aria-selected=${value === "" ? "true" : "false"} title="None" class=${`${cell} ${value === "" ? "bg-muted" : ""}`} @click=${() => this.pick("")}><span class="text-xs text-muted-foreground">None</span></button></li>` : null}
                    ${names.slice(0, this.shown).map(name => html`<li><button type="button" role="option" aria-selected=${name === value ? "true" : "false"} title=${name} class=${`${cell} ${name === value ? "bg-muted ring-1 ring-ring" : ""}`} @click=${() => this.pick(name)}>${component(Icon, { entry: icons[name]!, size: 20, variant: style })}</button></li>`)}
                </ul>
                ${names.length > this.shown ? html`<button type="button" class="mt-2 w-full rounded-md border border-border bg-background py-1.5 text-xs text-foreground cursor-pointer hover:bg-muted" @click=${() => { this.shown += PAGE; }}>Show more (${names.length - this.shown})</button>` : null}
                ${icons && !names.length ? html`<p class="py-4 text-center text-sm text-muted-foreground">No icons match.</p>` : null}`}
            </div>`);
    }
}
