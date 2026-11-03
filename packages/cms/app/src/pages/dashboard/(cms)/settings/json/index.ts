import { Client, ClientState, Cossack, Inject, Page, PreventNavigation, Server, server$, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, CodeEditor } from '@cossackframework/ui';
import { component, html, key } from '@cossackframework/renderer';
import { isCmsError, isNetworkAdmin, MAIN_SITE, parseSettingsDocument, PERMISSIONS, SETTINGS_DOCUMENT_MAX_BYTES, SETTINGS_DOCUMENT_MAX_FIELDS, settingsJsonSchema, stringifySettingsDocument, type SettingsDocument } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { formatSettingsDraft, mergeSettings, settingsChanges, SettingsDraft, settingsNavigation } from '../../../../../cms/settings-draft';
import { settingsEditorSnapshot } from '../../../../../cms/settings-form';
import { settingsErrorSummary, settingsFrame, settingsLinks, type SettingsLink } from '../../../../../cms/settings-nav';
import { notice, pageHeader } from '../../../../../cms/ui';
import { settingsSearchEntries, type SettingsSearchEntry } from '../../../../../cms/settings-search';

interface JsonSettingsView { links: SettingsLink[]; entries: SettingsSearchEntry[]; snapshot: SettingsDocument; invalid: Record<string, string>; schema: object; references: string[] }
interface PreviewResult { before: SettingsDocument; after: SettingsDocument; patch: SettingsDocument; error: string; fields: Record<string, string> }
const EDITOR_CLASS = 'rounded-md border border-input bg-background [&_.cm-editor]:h-[60vh] [&_.cm-editor]:max-h-[36rem] [&_.cm-scroller]:overflow-auto [&_pre]:max-h-[60vh] [&_pre]:overflow-auto';

@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSettings)] })
export default class JsonSettingsPage extends Cossack {
    @Inject(SettingsDraft) private draft!: SettingsDraft;
    view: JsonSettingsView = server$(async () => {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const groups = cms.settings.catalog({ principal });
        const snapshot = await settingsEditorSnapshot(cms, principal);
        // The Network section's link, as on Settings.
        const network = isNetworkAdmin(principal) && this.c.get('site')?.id === MAIN_SITE;
        return { links: settingsLinks(cms, { network }), entries: settingsSearchEntries(cms, { network }), snapshot: snapshot.document, invalid: snapshot.errors, schema: settingsJsonSchema(groups),
            references: groups.flatMap(group => Object.entries(group.fields).filter(([, field]) => field.control === 'file' || field.source && ['roles', 'pages', 'categories', 'media'].includes(field.source)).map(([name]) => `${group.id}.${name}`)) };
    }, { initial: { links: [], entries: [], snapshot: {}, invalid: {}, schema: {}, references: [] } });
    @ClientState() error = '';
    @ClientState() errors: Record<string, string> = {};
    @ClientState() message = '';
    @ClientState() draftRevision = 0;
    private unsubscribeDraft?: () => void;

    head(): HeadValue { return { title: __('Settings JSON') }; }

    onMount() {
        this.draft.navigated(window.location.pathname);
        this.draft.initialize(this.view.snapshot, this.view.invalid);
        this.unsubscribeDraft = this.draft.subscribe(() => { this.draftRevision++; });
    }

    onCleanup() { this.unsubscribeDraft?.(); }

    @PreventNavigation()
    @Client()
    confirmLeave(): boolean { return this.draft.preventNavigation(); }

    @Client()
    edit(text: string) {
        this.draft.editJson(text);
        this.error = '';
        this.errors = {};
        this.message = '';
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        if (this.draft.saving) return;
        if (this.draft.preview) await this.applyChanges();
        else await this.previewChanges();
    }

    @Client()
    async previewChanges() {
        if (this.draft.jsonError || Object.keys(this.draft.errors).length) return;
        try { await this.showPreview(stringifySettingsDocument(this.draft.changes()), false); }
        catch (error) { this.error = error instanceof Error ? error.message : __('The settings could not be checked.'); }
    }

    @Client()
    async importFile(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        this.message = '';
        this.error = '';
        if (this.draft.dirty()) { this.error = __('Save the current draft before importing a file.'); return; }
        if (file.size > SETTINGS_DOCUMENT_MAX_BYTES) { this.error = __('The settings file exceeds the supported size limit.'); return; }
        try { await this.showPreview(await file.text(), true); }
        catch { this.error = __('The settings file could not be read.'); }
    }

    @Client()
    async showPreview(text: string, imported: boolean) {
        if (this.draft.saving) return;
        this.draft.setSaving(true);
        this.error = '';
        this.errors = {};
        this.message = '';
        const source = this.draft.rawJson;
        try {
            // Parse on both sides: immediate local size/syntax feedback and an authoritative server check.
            parseSettingsDocument(text);
            const result = await this.preview(text, imported);
            if (source !== this.draft.rawJson) { this.error = __('The draft changed while it was checked. Preview the current changes again.'); return; }
            this.error = result.error;
            this.errors = result.fields;
            this.draft.setPreview(result.error ? null : { before: result.before, after: result.after, patch: result.patch, imported });
        } catch (error) { this.error = error instanceof Error ? error.message : __('The settings could not be checked.'); }
        finally { this.draft.setSaving(false); }
    }

    @Client()
    cancelPreview() { this.draft.setPreview(null); this.error = ''; this.errors = {}; }

    @Client()
    openError(event: MouseEvent) {
        settingsNavigation(event);
        // Keep the link's DOM intact until the document router consumes the click.
        if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) setTimeout(() => this.draft.setSearch(''), 0);
    }

    @Client()
    async applyChanges() {
        const preview = this.draft.preview;
        if (!preview || this.draft.saving) return;
        this.draft.setSaving(true);
        this.error = '';
        this.message = '';
        try {
            const result = await this.apply(preview.patch);
            this.error = result.error;
            this.errors = result.fields;
            if (result.document) { this.draft.accept(result.document); this.message = __('Settings saved.'); }
        } catch { this.error = __('The settings could not be saved. Your draft is kept.'); }
        finally { this.draft.setSaving(false); }
    }

    @Client()
    async exportSaved() {
        this.error = '';
        try {
            const text = await this.download();
            const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'settings.json';
            link.click();
            URL.revokeObjectURL(url);
        } catch (error) { this.error = error instanceof Error ? error.message : __('The saved settings could not be exported.'); }
    }

    @Server()
    async preview(text: string, imported = false): Promise<PreviewResult> {
        try {
            const settings = this.c.get('cms').settings;
            const context = { principal: this.c.get('principal') };
            const proposed = settings.validateDocument(parseSettingsDocument(text), context);
            settings.refresh();
            const before = (await settingsEditorSnapshot(this.c.get('cms'), context.principal)).document;
            const patch = imported ? proposed : settingsChanges(before, proposed);
            return { before, after: mergeSettings(before, patch), patch, error: '', fields: {} };
        } catch (error) { return { before: {}, after: {}, patch: {}, error: isCmsError(error) ? error.message : __('The settings could not be checked.'), fields: isCmsError(error) ? { ...error.fields } : {} }; }
    }

    @Server()
    async apply(document: SettingsDocument): Promise<{ document: SettingsDocument | null; error: string; fields: Record<string, string> }> {
        try { return { document: await this.c.get('cms').settings.applyDocument(document, { principal: this.c.get('principal') }), error: '', fields: {} }; }
        catch (error) { return { document: null, error: isCmsError(error) ? error.message : __('The settings could not be saved.'), fields: isCmsError(error) ? { ...error.fields } : {} }; }
    }

    @Server()
    async download(): Promise<string> { return this.c.get('cms').settings.exportDocument({ principal: this.c.get('principal') }); }

    render() {
        const preview = this.draft.preview;
        const busy = this.draft.saving;
        const text = this.draft.initialized ? this.draft.rawJson : formatSettingsDraft(this.view.snapshot);
        const invalid = this.draft.initialized ? this.draft.baselineErrors : this.view.invalid;
        const references = preview ? this.view.references.filter(path => Object.entries(preview.patch).some(([group, fields]) => Object.keys(fields).some(name => `${group}.${name}` === path))) : [];
        return settingsFrame(this.view.links, 'json', html`<div class="space-y-5">
            <form id="settings-actions" hidden @submit=${this.submit}></form>
            ${pageHeader(__('Settings JSON'), { description: __('Edit settings as namespace and field pairs. Missing fields keep their saved values.') })}
            <p class="text-sm text-muted-foreground">${__('Appearance, theme options, Languages, Permalinks, and server credentials use their own save operations and are excluded. This file is not a full site backup.')}</p>
            <p class="text-xs text-muted-foreground">${__('Maximum JSON file size')}: ${Math.floor(SETTINGS_DOCUMENT_MAX_BYTES / 1024)} KiB; ${SETTINGS_DOCUMENT_MAX_FIELDS} ${__('fields')}. ${__('Only strings, numbers, booleans, and declared null values are supported.')}</p>
            <div class="flex flex-wrap items-center gap-3">
                ${component(Button, { type: 'button', variant: 'outline', disabled: !!this.loading.download, '@click': this.exportSaved }, __('Export saved settings'))}
                <label class="text-sm font-medium">${__('Import settings JSON')}<input type="file" accept=".json,application/json" aria-label=${__('Import settings JSON')} class="mt-1 block max-w-full text-sm" ?disabled=${busy} @change=${this.importFile}></label>
            </div>
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error || this.draft.jsonError ? notice(this.error || this.draft.jsonError, 'error') : null}
            ${Object.keys(invalid).length ? html`<div role="alert">${notice(__('Some saved values no longer match their declarations. Add corrected values for these omitted fields before saving.'), 'error')}<ul class="mt-2 text-sm">${Object.keys(invalid).map(path => html`<li><code>${path}</code></li>`)}</ul></div>` : null}
            ${settingsErrorSummary(this.errors, this.openError)}
            ${this.draft.hasInvalidControls() ? html`<div role="alert">${notice(__('Fix the invalid form values before editing JSON.'), 'error')}<a href="/dashboard/settings" @click=${settingsNavigation} class="text-sm text-primary underline">${__('Open settings')}</a></div>` : null}
            ${preview ? component(Card, {}, component(CardBody, { class: 'space-y-4' }, html`
                <h2 class="font-semibold">${__('Review changes')}</h2>
                <p class="text-sm text-muted-foreground">${__('Nothing is saved until you apply these changes.')}</p>
                ${preview.imported ? html`<p class="text-sm text-muted-foreground">${__('Every supplied value is saved explicitly, including unchanged defaults.')}</p>` : null}
                ${references.length ? html`<p role="status" class="text-sm text-muted-foreground">${__('These references are copied as stored and are not remapped to this site')}: ${references.join(', ')}.</p>` : null}
                ${key(formatSettingsDraft(preview.patch), component(CodeEditor, { id: 'settings-json-diff', language: 'json', label: __('Settings changes'), class: EDITOR_CLASS, original: formatSettingsDraft(preview.before), value: formatSettingsDraft(preview.after) }))}
                ${component(Button, { type: 'button', variant: 'outline', disabled: busy, '@click': this.cancelPreview }, __('Cancel preview'))}
                ${Object.keys(preview.patch).length ? null : html`<p role="status" class="text-sm text-muted-foreground">${__('No settings would change.')}</p>`}
            `)) : html`
                ${key(busy || this.draft.hasInvalidControls(), component(CodeEditor, { id: 'settings-json-editor', language: 'json', label: __('Settings JSON'), value: text, schema: this.view.schema,
                    readOnly: busy || this.draft.hasInvalidControls(), class: EDITOR_CLASS, onChange: this.edit }))}
            `}
        </div>`, { entries: this.view.entries, query: this.draft.search });
    }
}
