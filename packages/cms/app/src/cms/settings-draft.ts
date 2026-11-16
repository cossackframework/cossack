/** A client draft owned by the Settings layout, never a process-wide settings cache. */
import { Client, ClientState, createStore, Service, Shared } from '@cossackframework/core';
import { parseSettingsDocument, type SettingsDocument } from '@cossackframework/cms';
import type { SettingRow, SettingValue } from './settings-form';

export function settingsChanges(before: SettingsDocument, after: SettingsDocument): SettingsDocument {
    const changes: SettingsDocument = {};
    for (const [group, fields] of Object.entries(after)) {
        for (const [name, value] of Object.entries(fields)) {
            if (!Object.hasOwn(before[group] ?? {}, name) || !Object.is(before[group]?.[name], value)) (changes[group] ??= {})[name] = value;
        }
    }
    return changes;
}

export function mergeSettings(before: SettingsDocument, patch: SettingsDocument): SettingsDocument {
    const result: SettingsDocument = {};
    for (const [group, fields] of Object.entries(before)) result[group] = { ...fields };
    for (const [group, fields] of Object.entries(patch)) result[group] = { ...result[group], ...fields };
    return result;
}

/** Editor display is not an import/export operation; a site's full catalog can exceed file limits. */
export function formatSettingsDraft(document: SettingsDocument): string {
    const sorted = Object.fromEntries(Object.keys(document).sort().map(group => [group,
        Object.fromEntries(Object.keys(document[group]!).sort().map(name => [name, document[group]![name]]))]));
    return `${JSON.stringify(sorted, null, 2)}\n`;
}

// A click reaches the framework router in the same event turn. Clearing this marker in
// a task also handles canceled clicks, same-page links, and failed navigation. A
// microtask is too early: browsers checkpoint between native event listeners.
let settingsClick: object | undefined;
export function settingsNavigation(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.currentTarget as HTMLAnchorElement;
    if (anchor.target && anchor.target !== '_self' || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || !isSettingsPath(url.pathname)) return;
    const marker = {};
    settingsClick = marker;
    setTimeout(() => { if (settingsClick === marker) settingsClick = undefined; }, 0);
}

export function isSettingsPath(path: string): boolean { return path === '/dashboard/settings' || path.startsWith('/dashboard/settings/'); }

export interface SettingsPreview { before: SettingsDocument; after: SettingsDocument; patch: SettingsDocument; imported: boolean }

@Service()
export class SettingsDraft {
    @ClientState() initialized = false;
    @ClientState() baseline: SettingsDocument = {};
    @ClientState() values: SettingsDocument = {};
    @ClientState() rawJson = '';
    @ClientState() jsonError = '';
    @ClientState() controls: Record<string, SettingValue> = {};
    @ClientState() errors: Record<string, string> = {};
    @ClientState() baselineErrors: Record<string, string> = {};
    @ClientState() jsonEdited = false;
    @ClientState() preview: SettingsPreview | null = null;
    @ClientState() search = '';
    @ClientState() saving = false;
    @ClientState() toolbarHeight = 56;
    /** Invalidates pending controls when the whole document is replaced or discarded. */
    @ClientState() epoch = 0;
    /** Counts the toolbar's discards, so the page can clear what the last save reported. */
    @ClientState() discards = 0;
    @ClientState() sections: Record<string, unknown> = {};
    @ClientState() sectionBaselines: Record<string, unknown> = {};
    private pathname = '';
    private changesStore = createStore(0);

    @Client()
    subscribe(listener: () => void): () => void { return this.changesStore.subscribe(listener); }

    @Client()
    changed(): void { this.changesStore.update(revision => revision + 1); }

    @Client()
    setSearch(search: string): void { this.search = search; this.changed(); }

    @Client()
    setSaving(saving: boolean): void { if (saving && !this.saving) this.epoch++; this.saving = saving; this.changed(); }

    @Client()
    setToolbarHeight(height: number): void { if (height !== this.toolbarHeight) { this.toolbarHeight = height; this.changed(); } }

    @Shared()
    section<T>(key: string, initial: T): T { return Object.hasOwn(this.sections, key) ? this.sections[key] as T : initial; }

    @Client()
    initializeSection<T>(key: string, initial: T): void { if (!Object.hasOwn(this.sections, key)) this.acceptSection(key, initial); }

    @Client()
    setSection<T>(key: string, value: T): void { this.sections = { ...this.sections, [key]: structuredClone(value) }; this.changed(); }

    @Client()
    acceptSection<T>(key: string, value: T): void {
        this.sectionBaselines = { ...this.sectionBaselines, [key]: structuredClone(value) };
        this.setSection(key, value);
    }

    @Client()
    discardSection(key: string): void { if (Object.hasOwn(this.sectionBaselines, key)) this.setSection(key, this.sectionBaselines[key]); }

    @Shared()
    sectionDirty(key: string): boolean { return JSON.stringify(this.sections[key]) !== JSON.stringify(this.sectionBaselines[key]); }

    @Client()
    setPreview(preview: SettingsPreview | null): void { this.preview = preview; this.changed(); }

    @Client()
    initialize(document: SettingsDocument, errors: Record<string, string> = {}): void {
        if (!this.initialized) { this.accept(document); this.errors = { ...errors }; this.baselineErrors = { ...errors }; this.changed(); }
    }

    @Client()
    accept(document: SettingsDocument): void {
        this.epoch++;
        this.baseline = mergeSettings({}, document);
        this.values = mergeSettings({}, document);
        this.rawJson = formatSettingsDraft(document);
        this.jsonError = '';
        this.controls = {};
        this.errors = {};
        this.baselineErrors = {};
        this.jsonEdited = false;
        this.preview = null;
        this.initialized = true;
        this.changed();
    }

    @Client()
    discard(): void {
        const errors = this.baselineErrors;
        this.accept(this.baseline);
        this.baselineErrors = errors;
        this.errors = { ...errors };
        this.sections = structuredClone(this.sectionBaselines);
        this.discards++;
        this.changed();
    }

    @Shared()
    hasInvalidControls(): boolean { return Object.keys(this.errors).some(key => !Object.hasOwn(this.baselineErrors, key)); }

    @Shared()
    changes(): SettingsDocument { return settingsChanges(this.baseline, this.values); }

    @Shared()
    documentDirty(): boolean { return !!this.jsonError || this.hasInvalidControls() || Object.keys(this.changes()).length > 0 || !!this.preview && Object.keys(this.preview.patch).length > 0; }

    @Shared()
    dirty(): boolean { return this.documentDirty() || Object.keys(this.sections).some(key => this.sectionDirty(key)); }

    @Shared()
    control(row: SettingRow, fallback?: SettingValue): SettingValue | undefined {
        const key = `${row.namespace}.${row.name}`;
        if (Object.hasOwn(this.controls, key)) return this.controls[key];
        if (!Object.hasOwn(this.values[row.namespace] ?? {}, row.name)) return fallback;
        const value = this.values[row.namespace]![row.name];
        return typeof value === 'number' ? String(value) : value;
    }

    @Client()
    set(row: SettingRow, value: SettingValue): void {
        if (this.jsonError || this.preview?.imported) return;
        this.preview = null;
        const key = `${row.namespace}.${row.name}`;
        this.controls = { ...this.controls, [key]: value };
        const errors = { ...this.errors };
        delete errors[key];
        let typed: string | number | boolean | null = value;
        if (value !== null && (row.kind === 'number' || row.kind === 'integer')) {
            typed = Number(value);
            if (typeof value !== 'string' || value.trim() === '' || !Number.isFinite(typed)) errors[key] = 'must be a number.';
        } else if (typeof value === 'string' && row.kind !== 'text') typed = value.trim();
        this.errors = errors;
        if (errors[key]) { this.changed(); return; }
        this.values = mergeSettings(this.values, { [row.namespace]: { [row.name]: typed } });
        this.rawJson = formatSettingsDraft(this.values);
        this.jsonEdited = false;
        this.changed();
    }

    @Client()
    editJson(text: string): void {
        this.epoch++;
        this.rawJson = text;
        this.jsonEdited = true;
        this.preview = null;
        try {
            const patch = parseSettingsDocument(text);
            this.values = mergeSettings(this.baseline, patch);
            this.controls = {};
            this.errors = {};
            this.jsonError = '';
        } catch (error) {
            this.jsonError = error instanceof Error ? error.message : 'Enter valid settings JSON.';
        }
        this.changed();
    }

    @Client()
    navigated(pathname: string): void { this.pathname = pathname; }

    @Client()
    preventNavigation(): boolean {
        const internalClick = settingsClick !== undefined;
        settingsClick = undefined;
        const historyWithinSettings = this.pathname !== window.location.pathname && isSettingsPath(window.location.pathname);
        if (internalClick || historyWithinSettings || !this.dirty()) return false;
        return !window.confirm(__('Leave Settings? Your changes are not saved.'));
    }

    @Shared()
    onDispose(): void { settingsClick = undefined; }
}
