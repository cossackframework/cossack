import { html, type TemplateResult } from "@cossackframework/renderer";
import { Client, ClientState, Component, Cossack } from "@cossackframework/core";
import type { IconEntry, IconStyle } from "@cossackframework/solar-icons/types";
import { Icon } from "../icons/Icon";
import { Popover } from "./Popover";
import { component } from "@cossackframework/renderer";

/** A category of a catalog: its id, the tab's label, and the names it holds. */
export interface IconPickerCategory {
    readonly id: string;
    readonly label: string;
    readonly names: readonly string[];
}

/**
 * A catalog: icons by category, each drawn through `entry(name)`, so the picker can offer a
 * whole icon set whose artwork lives in sprites rather than in the bundle. `icon` names the
 * icon a category tab shows; when absent, the tab shows the category's first icon.
 */
export interface IconPickerCatalog {
    readonly categories: readonly IconPickerCategory[];
    entry(name: string): IconEntry;
    readonly icon?: (category: IconPickerCategory) => string;
}

/** Icons the picker offers, by name; a loader for them, called the first time the picker opens; or a catalog by category. */
export type IconPickerSource = Readonly<Record<string, IconEntry>> | (() => Promise<Readonly<Record<string, IconEntry>>>) | IconPickerCatalog;

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
/** Where a catalog picker keeps the icons picked last, per browser. */
const RECENT_KEY = "cs-icon-picker-recent";
const RECENT_LIMIT = 24;
const RECENT = "recent";

export function isIconPickerCatalog(source: IconPickerSource): source is IconPickerCatalog {
    return typeof source === "object" && source !== null && "categories" in source && typeof (source as IconPickerCatalog).entry === "function";
}

function readRecent(): string[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
        return Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === "string").slice(0, RECENT_LIMIT) : [];
    } catch { return []; }
}

function writeRecent(names: string[]): void {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(names.slice(0, RECENT_LIMIT))); } catch { /* storage may be unavailable */ }
}

/**
 * Cossack UI IconPicker — a button showing the chosen icon that opens a searchable grid of
 * icons. Give it the icons you ship (a map of name to entry) so bundles stay small, a loader for
 * a larger set, such as `() => import('@cossackframework/solar-icons/registry')
 * .then(m => m.iconRegistry)`, which downloads only when someone opens the picker, or a catalog
 * (`{ categories, entry }`): then a row of category tabs sits under the search box, the way an
 * emoji picker browses, with the icons picked last first, and a search looks across every category.
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
    /** The open category of a catalog: a category id, or `recent`. Empty before the first open. */
    @ClientState() private category = "";
    @ClientState() private recent: string[] = [];

    private get catalog(): IconPickerCatalog | null {
        return isIconPickerCatalog(this.props.icons) ? this.props.icons : null;
    }

    private get available(): Readonly<Record<string, IconEntry>> | null {
        const source = this.props.icons;
        if (isIconPickerCatalog(source)) return null;
        return typeof source === "function" ? this.loaded : source;
    }

    @Client()
    private async load() {
        if (this.catalog) {
            // Each open starts on the icons picked last, as an emoji picker does, else on the first category.
            this.recent = readRecent();
            this.category = this.recent.length ? RECENT : this.catalog.categories[0]?.id ?? "";
            return;
        }
        const source = this.props.icons;
        if (this.available || this.busy || typeof source !== "function") return;
        this.busy = true;
        try { this.loaded = await source(); }
        catch (error) { console.error("[ui] the icons could not load", error); this.failed = true; }
        finally { this.busy = false; }
    }

    @Client()
    private pick(name: string) {
        const panel = document.getElementById(`${this.props.id}-picker-content`);
        if (panel && typeof panel.hidePopover === "function") panel.hidePopover();
        this.search = "";
        this.shown = PAGE;
        if (this.catalog && name) {
            this.recent = [name, ...this.recent.filter(other => other !== name)].slice(0, RECENT_LIMIT);
            writeRecent(this.recent);
        }
        this.props.onChange?.(name);
    }

    @Client()
    private query(value: string) {
        this.search = value;
        this.shown = PAGE;
    }

    @Client()
    private open(category: string) {
        this.category = category;
        this.shown = PAGE;
    }

    /** The names shown: a search looks across everything; otherwise the open category, or the whole map. */
    private names(query: string): string[] {
        const catalog = this.catalog;
        if (catalog) {
            if (query) return catalog.categories.flatMap(category => category.names).filter(name => name.includes(query));
            if (this.category === RECENT) return this.recent;
            return [...(catalog.categories.find(category => category.id === this.category) ?? catalog.categories[0])?.names ?? []];
        }
        const icons = this.available;
        return icons ? Object.keys(icons).filter(name => !query || name.includes(query)) : [];
    }

    private entry(name: string): IconEntry | undefined {
        return this.catalog ? this.catalog.entry(name) : this.available?.[name];
    }

    render(): TemplateResult {
        const { id, value, label = "Icon", allowEmpty = true, style = "line" } = this.props;
        const catalog = this.catalog;
        const icons = this.available;
        const ready = !!catalog || !!icons;
        const current = value ? this.entry(value) : undefined;
        const query = this.search.trim().toLowerCase().replace(/\s+/g, "-");
        const names = this.names(query);
        const cell = "flex aspect-square w-full items-center justify-center rounded-md border-none bg-transparent text-foreground cursor-pointer hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-5";
        const tab = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-none bg-transparent text-muted-foreground cursor-pointer hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-muted aria-selected:text-foreground [&_svg]:size-4";
        const openCategory = catalog ? (this.category === RECENT ? RECENT : (catalog.categories.find(category => category.id === this.category) ?? catalog.categories[0])?.id ?? "") : "";
        const heading = catalog && !query ? (openCategory === RECENT ? "Recent" : catalog.categories.find(category => category.id === openCategory)?.label ?? "") : "";
        return component(Popover, {
            id: `${id}-picker`, side: "bottom", align: "start", "?disabled": Boolean(this.props.disabled),
            class: "cs-icon-picker inline-flex h-9 min-w-9 items-center gap-2 rounded-md border border-input bg-background px-2 text-sm text-foreground shadow-xs hover:bg-muted",
            "aria-label": label, title: value || label,
            trigger: html`<span class="inline-flex [&_svg]:size-4" aria-hidden="true">${current ? component(Icon, { entry: current, size: 16, variant: style }) : html`<span class="text-muted-foreground">—</span>`}</span><span class="max-w-40 truncate">${value || "None"}</span>`,
            contentProps: { role: "dialog", "aria-label": label, class: `${catalog ? "w-96" : "w-80"} max-w-[calc(100vw-2rem)] space-y-2`, "@toggle": (event: Event) => { if ((event as ToggleEvent).newState === "open") void this.load(); } },
        }, html`
            <input type="search" aria-label=${`Search ${label.toLowerCase()}s`} placeholder="Search" .value=${this.search}
                class="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                @input=${(event: Event) => this.query((event.target as HTMLInputElement).value)}>
            ${catalog && !query ? html`<div role="tablist" aria-label="Categories" class="flex gap-0.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
                ${this.recent.length ? html`<button type="button" role="tab" aria-selected=${openCategory === RECENT ? "true" : "false"} title="Recent" class=${tab} @click=${() => this.open(RECENT)}><span class="text-xs" aria-hidden="true">★</span></button>` : null}
                ${catalog.categories.map(category => html`<button type="button" role="tab" aria-selected=${openCategory === category.id ? "true" : "false"} title=${category.label} class=${tab} @click=${() => this.open(category.id)}>${component(Icon, { entry: catalog.entry(catalog.icon?.(category) ?? category.names[0]!), size: 16, variant: style })}</button>`)}
            </div>` : null}
            ${heading ? html`<p class="px-0.5 text-xs font-medium text-muted-foreground">${heading}</p>` : null}
            <div class="max-h-72 overflow-y-auto">
                ${this.failed ? html`<p role="alert" class="py-4 text-center text-sm text-destructive">The icons could not load.</p>`
                : !ready ? html`<p class="py-4 text-center text-sm text-muted-foreground">Loading icons…</p>`
                : html`<ul class=${catalog ? "grid grid-cols-8 gap-1" : "grid grid-cols-6 gap-1"} role="listbox" aria-label=${label}>
                    ${allowEmpty && !query && (!catalog || openCategory !== RECENT) ? html`<li><button type="button" role="option" aria-selected=${value === "" ? "true" : "false"} title="None" class=${`${cell} ${value === "" ? "bg-muted" : ""}`} @click=${() => this.pick("")}><span class="text-xs text-muted-foreground">None</span></button></li>` : null}
                    ${names.slice(0, this.shown).map(name => html`<li><button type="button" role="option" aria-selected=${name === value ? "true" : "false"} title=${name} class=${`${cell} ${name === value ? "bg-muted ring-1 ring-ring" : ""}`} @click=${() => this.pick(name)}>${component(Icon, { entry: this.entry(name)!, size: 20, variant: style })}</button></li>`)}
                </ul>
                ${names.length > this.shown ? html`<button type="button" class="mt-2 w-full rounded-md border border-border bg-background py-1.5 text-xs text-foreground cursor-pointer hover:bg-muted" @click=${() => { this.shown += PAGE; }}>Show more (${names.length - this.shown})</button>` : null}
                ${ready && !names.length ? html`<p class="py-4 text-center text-sm text-muted-foreground">No icons match.</p>` : null}`}
            </div>`);
    }
}
