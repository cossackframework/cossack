import { Client, ClientState, Cossack, Inject, OnWindow, Page, PreventNavigation, Server, Shared, server$, type HeadValue } from '@cossackframework/core';
import { Badge, Button, Card, CardBody } from '@cossackframework/ui';
import { component, html, repeat, type TemplateResult } from '@cossackframework/renderer';
import { hasPermission, isCmsError, PERMISSIONS, type SettingsDocument, type SettingsSection as SectionDeclaration } from '@cossackframework/cms';
import { requireAny } from '../../../../cms/guards';
import { SettingsDraft, settingsNavigation } from '../../../../cms/settings-draft';
import { findSettingsMedia, settingControl, settingInput, settingRows, settingsEditorSnapshot, type SettingRow, type SettingValue, type SettingValues } from '../../../../cms/settings-form';
import { filterSettingsLinks, settingsErrorSummary, settingsFrame, settingsLinks, type SettingsLink } from '../../../../cms/settings-nav';
import { searchSettings, settingsSearchEntries, settingsSectionId, type SettingsSearchEntry } from '../../../../cms/settings-search';
import { SettingsSection } from '../../../../cms/settings-section';
import { activeSettingsSection } from '../../../../cms/settings-scroll';
import { LanguagesSettings, loadLanguageSettings, saveLanguageSettings, type LanguageSettingsData, type LanguageSettingsInput } from '../../../../cms/settings-languages';
import { PermalinksSettings, loadPermalinkSettings, savePermalinkSettings, type PermalinkSettingsData, type PermalinkSettingsInput } from '../../../../cms/settings-permalinks';
import { notice } from '../../../../cms/ui';

interface GroupView {
    id: string; label: string; description: string; plugin: string; active: boolean; theme: boolean; portable: boolean;
    sections: readonly SectionDeclaration[]; rows: SettingRow[]; values: SettingValues;
}
interface SettingsView {
    links: SettingsLink[]; entries: SettingsSearchEntry[]; groups: GroupView[];
    canUpload: boolean; canBrowse: boolean;
    snapshot: SettingsDocument; invalid: Record<string, string>; languages: LanguageSettingsData | null; permalinks: PermalinkSettingsData | null;
}

/** One document of settings. The menu and visible fields use the same search matches. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSettings)] })
export default class SettingsPage extends Cossack {
    @Inject(SettingsDraft) private draft!: SettingsDraft;
    view: SettingsView = server$(async (): Promise<SettingsView> => {
        const cms = this.c.get('cms'), principal = this.c.get('principal');
        const origin = new URL(this.c.req.url).origin;
        const status = await cms.status();
        const portable = new Set(cms.settings.catalog({ principal }).map(group => group.id));
        const groups = await Promise.all(cms.settings.groups.filter(group => group.id !== 'languages' && (group.permission ?? PERMISSIONS.manageSettings) === PERMISSIONS.manageSettings).map(async group => ({
            id: group.id, label: group.label, description: group.description ?? '', plugin: group.plugin ?? '',
            active: status.plugins.find(plugin => plugin.name === group.plugin)?.active ?? false,
            theme: cms.themes().some(theme => theme.name === group.plugin), portable: portable.has(group.id),
            sections: group.sections ?? [], ...await settingRows(cms, group, principal),
        })));
        const snapshot = await settingsEditorSnapshot(cms, principal);
        return { links: settingsLinks(cms), entries: settingsSearchEntries(cms), groups, snapshot: snapshot.document, invalid: snapshot.errors,
            canUpload: !!cms.files && hasPermission(principal, PERMISSIONS.upload),
            canBrowse: !!cms.files && [PERMISSIONS.upload, PERMISSIONS.manageMedia, PERMISSIONS.manageUsers].some(permission => hasPermission(principal, permission)),
            languages: await loadLanguageSettings(cms, origin), permalinks: loadPermalinkSettings(cms, origin) };
    }, { initial: { links: [], entries: [], groups: [], canUpload: false, canBrowse: false, snapshot: {}, invalid: {}, languages: null, permalinks: null } });
    @ClientState() message = '';
    @ClientState() error = '';
    @ClientState() errors: Record<string, string> = {};
    @ClientState() revision = 0;
    @ClientState() target = 'general';
    @ClientState() active = 'general';
    private unsubscribe?: () => void;
    private sectionElements = new Map<string, Element>();
    private resize?: ResizeObserver;
    private scrollFrame?: number;
    private scrollJump = 0;
    private pendingTarget?: string;
    private scrollQuiet?: ReturnType<typeof setTimeout>;
    private scrollDeadline = 0;

    head(): HeadValue { return { title: __('Settings') }; }

    onMount() {
        this.draft.initialize(this.view.snapshot, this.view.invalid);
        this.draft.navigated(window.location.pathname);
        for (const group of this.view.groups.filter(group => !group.portable)) this.draft.initializeSection(group.id, group.values);
        this.unsubscribe = this.draft.subscribe(() => { this.revision++; this.updateActiveSection(); });
        if (typeof ResizeObserver !== 'undefined') {
            this.resize = new ResizeObserver(this.sectionsResized);
            for (const element of this.sectionElements.values()) this.resize.observe(element);
        }
        this.revealHash();
        this.updateActiveSection();
    }

    onCleanup() { this.scrollJump++; clearTimeout(this.scrollQuiet); this.unsubscribe?.(); this.resize?.disconnect(); if (this.scrollFrame !== undefined) cancelAnimationFrame(this.scrollFrame); }

    @OnWindow('wheel')
    @OnWindow('touchstart')
    @OnWindow('pointerdown')
    @OnWindow('keydown')
    @Client()
    cancelSectionJump() { this.scrollJump++; this.pendingTarget = undefined; clearTimeout(this.scrollQuiet); this.updateActiveSection(); }

    @Client()
    async scrollToSection(id: string) {
        const jump = ++this.scrollJump;
        this.pendingTarget = id;
        this.scrollDeadline = performance.now() + 1500;
        await this.requestUpdate();
        if (jump === this.scrollJump) this.sectionsResized();
    }

    @Client()
    sectionsResized() {
        if (this.pendingTarget) {
            this.sectionElements.get(this.pendingTarget)?.scrollIntoView({ block: 'start', behavior: 'instant' });
            clearTimeout(this.scrollQuiet);
            // IntersectionObserver mounts controls after paint. Their descendants can
            // resize later still, so wait for a quiet layout, bounded to 1.5 seconds.
            this.scrollQuiet = setTimeout(() => {
                this.pendingTarget = undefined;
                this.updateActiveSection();
            }, Math.max(0, Math.min(200, this.scrollDeadline - performance.now())));
        }
        this.updateActiveSection();
    }

    @Client()
    trackSection(id: string, element: Element | undefined) {
        const previous = this.sectionElements.get(id);
        if (previous === element) return;
        if (previous) this.resize?.unobserve(previous);
        if (element) { this.sectionElements.set(id, element); this.resize?.observe(element); }
        else this.sectionElements.delete(id);
        this.updateActiveSection();
    }

    @OnWindow('scroll')
    @OnWindow('resize')
    @Client()
    updateActiveSection() {
        if (this.scrollFrame !== undefined) return;
        this.scrollFrame = requestAnimationFrame(() => {
            this.scrollFrame = undefined;
            const sections = this.view.links
                .flatMap(link => {
                    const element = this.sectionElements.get(link.id);
                    return element?.isConnected ? [{ id: link.id, top: element.getBoundingClientRect().top }] : [];
                });
            const atEnd = window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
            const active = activeSettingsSection(sections, this.draft.toolbarHeight + 24, atEnd) ?? '';
            if (active !== this.active) this.active = active;
        });
    }

    @OnWindow('hashchange')
    @Client()
    async revealHash() {
        let anchor = window.location.hash.slice(1);
        try { anchor = decodeURIComponent(anchor); } catch { return; }
        const link = this.view.links.find(link => settingsSectionId(link.id) === anchor);
        if (link) {
            this.target = link.id;
            await this.scrollToSection(link.id);
        }
    }

    @PreventNavigation()
    @Client()
    confirmLeave(): boolean { return this.draft.preventNavigation(); }

    @Client()
    async openSection(event: MouseEvent) {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const url = new URL((event.currentTarget as HTMLAnchorElement).href, window.location.href);
        if (url.pathname !== '/dashboard/settings') { settingsNavigation(event); return; }
        event.preventDefault();
        const anchor = decodeURIComponent(url.hash.slice(1));
        const link = this.view.links.find(link => settingsSectionId(link.id) === anchor);
        if (!link) return;
        this.target = link.id;
        this.active = link.id;
        if ((event.currentTarget as HTMLElement).hasAttribute('data-settings-error-group') || !filterSettingsLinks(this.view.links, this.view.entries, this.draft.search).some(entry => entry.id === link.id)) this.draft.setSearch('');
        if (window.location.hash !== url.hash) history.pushState(history.state, '', url.hash);
        await this.scrollToSection(link.id);
    }

    @Client()
    set(group: GroupView, row: SettingRow, value: SettingValue) {
        if (this.draft.saving) return;
        if (group.portable) this.draft.set(row, value);
        else this.draft.setSection(group.id, { ...this.draft.section(group.id, group.values), [row.name]: value });
        this.message = '';
        const errors = { ...this.errors }; delete errors[`${group.id}.${row.name}`]; this.errors = errors;
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault(); this.error = ''; this.message = '';
        if (this.draft.saving || this.draft.jsonError || Object.keys(this.draft.errors).length || this.draft.preview?.imported || !this.draft.documentDirty()) return;
        this.draft.setSaving(true);
        try {
            const result = await this.save(this.draft.changes());
            this.error = result.error; this.errors = result.fields;
            if (result.document) { this.draft.accept(result.document); this.message = __('Settings saved.'); }
        } catch { this.error = __('The settings could not be saved. Your draft is kept.'); }
        finally { this.draft.setSaving(false); }
    }

    @Server()
    async findMedia(search: string, kind: string) { return findSettingsMedia(this.c.get('cms'), this.c.get('principal'), search, kind); }

    @Server()
    async save(document: SettingsDocument): Promise<{ document: SettingsDocument | null; error: string; fields: Record<string, string> }> {
        try { return { document: await this.c.get('cms').settings.applyDocument(document, { principal: this.c.get('principal') }), error: '', fields: {} }; }
        catch (error) { return { document: null, error: isCmsError(error) ? error.message : __('The settings could not be saved.'), fields: isCmsError(error) ? { ...error.fields } : {} }; }
    }

    @Client()
    async submitGroup(event: Event, group: GroupView) {
        event.preventDefault(); this.error = ''; this.message = '';
        if (this.draft.saving) return;
        this.draft.setSaving(true);
        const values = this.draft.section(group.id, group.values);
        try {
            const result = await this.saveGroup(group.id, values);
            this.error = result.error; this.errors = result.fields;
            if (!result.error) { this.draft.acceptSection(group.id, values); this.message = __('Settings saved.'); }
        } catch { this.error = __('The settings could not be saved. Your draft is kept.'); }
        finally { this.draft.setSaving(false); }
    }

    @Server()
    async saveGroup(id: string, values: SettingValues) {
        const cms = this.c.get('cms');
        const group = cms.settings.groups.find(group => group.id === id && !group.plugin && group.id !== 'languages' && (group.permission ?? PERMISSIONS.manageSettings) === PERMISSIONS.manageSettings);
        if (!group) return { error: __('These settings do not exist.'), fields: {} as Record<string, string> };
        const { input, errors } = settingInput(group, values);
        if (Object.keys(errors).length) return { error: __('Some settings are invalid.'), fields: Object.fromEntries(Object.entries(errors).map(([name, value]) => [`${id}.${name}`, value])) };
        try { await cms.settings.update(id, input, { principal: this.c.get('principal') }); return { error: '', fields: {} as Record<string, string> }; }
        catch (error) { return { error: isCmsError(error) ? error.message : __('The settings could not be saved.'), fields: isCmsError(error) ? { ...error.fields } : {} }; }
    }

    @Server()
    async saveLanguages(input: LanguageSettingsInput) { return saveLanguageSettings(this.c.get('cms'), this.c.get('principal'), input, new URL(this.c.req.url).origin); }

    @Server()
    async savePermalinks(input: PermalinkSettingsInput) { return savePermalinkSettings(this.c.get('cms'), this.c.get('principal'), input, new URL(this.c.req.url).origin); }

    @Shared()
    groupContent(group: GroupView, fields: Set<string>, blocked: boolean): TemplateResult {
        const controls = html`<fieldset class="min-w-0 space-y-5" ?disabled=${this.draft.saving || (group.portable ? blocked : !!this.loading.saveGroup)}>
            ${[{ id: '', label: '', description: '' }, ...group.sections].map(section => {
                const rows = group.rows.filter(row => row.section === section.id && fields.has(`${group.id}.${row.name}`));
                return rows.length ? html`<fieldset class="min-w-0 space-y-4">
                    ${section.label ? html`<legend class="mb-3 text-sm font-semibold">${section.label}</legend>` : null}
                    ${section.description ? html`<p class="text-sm text-muted-foreground">${section.description}</p>` : null}
                    ${repeat(rows, row => row.name, row => settingControl(row, group.portable ? this.draft.control(row, group.values[row.name]) : this.draft.section(group.id, group.values)[row.name],
                        this.draft.errors[`${group.id}.${row.name}`] ?? this.errors[`${group.id}.${row.name}`], value => this.set(group, row, value),
                        this.view.canBrowse ? { find: this.findMedia, canUpload: this.view.canUpload, epoch: () => this.draft.epoch } : undefined))}
                </fieldset>` : null;
            })}
        </fieldset>`;
        return component(Card, group.plugin ? { 'data-plugin-settings': group.plugin } : {}, component(CardBody, {}, group.portable ? controls : html`<form @submit=${(event: Event) => this.submitGroup(event, group)} class="space-y-4">
            ${controls}${component(Button, { type: 'submit', disabled: !!this.loading.saveGroup || !this.draft.sectionDirty(group.id) }, `${__('Save')} ${group.label}`)}
        </form>`));
    }

    render() {
        const matches = searchSettings(this.view.entries, this.draft.search);
        const fields = new Set(matches.map(entry => entry.id));
        const blocked = !!this.draft.jsonError || !!this.draft.preview?.imported;
        const ordered = filterSettingsLinks(this.view.links, this.view.entries, this.draft.search);
        return settingsFrame(this.view.links, this.active, html`<div class="min-w-0 space-y-8">
            <form id="settings-actions" hidden @submit=${this.submit}></form>
            <div class="space-y-4">
                ${this.draft.search.trim() ? html`<p role="status" data-settings-results class="text-sm text-muted-foreground">${matches.length ? matches.length === 1 ? __('1 setting found') : `${matches.length} ${__('settings found')}` : __('No settings match your search.')}</p>` : null}
                ${this.message ? notice(this.message, 'success') : null}${this.error ? notice(this.error, 'error') : null}
                ${settingsErrorSummary({ ...this.errors, ...this.draft.errors }, this.openSection)}
                ${Object.keys(this.draft.initialized ? this.draft.baselineErrors : this.view.invalid).length ? notice(__('Some saved values no longer match their declarations. Set a valid value for each affected field before saving.'), 'error') : null}
                ${blocked ? html`<div role="alert">${notice(__('Fix the JSON draft, or resolve its import preview, before editing fields.'), 'error')}<a href="/dashboard/settings/json" @click=${settingsNavigation} class="text-sm text-primary underline">${__('Open JSON draft')}</a></div>` : null}
                ${this.draft.dirty() ? html`<p role="status" class="text-xs text-muted-foreground">${__('Unsaved changes, including settings hidden by search.')}</p>` : null}
            </div>
            ${repeat(ordered, link => link.id, link => {
                if (link.id === 'plugins') return html`<div id=${settingsSectionId('plugins')} ref=${(element: Element | undefined) => this.trackSection('plugins', element)} class="space-y-2" style="scroll-margin-top:calc(var(--settings-toolbar-height, 56px) + 24px)"><h2 class="text-xl font-semibold">${__('Plugins')}</h2><a href="/dashboard/plugins" class="text-sm text-primary hover:underline">${__('Manage plugins')}</a>
                    ${this.view.groups.some(group => group.plugin) ? null : html`<p class="text-sm text-muted-foreground">${__('No installed plugins declare settings.')}</p>`}</div>`;
                const group = this.view.groups.find(group => group.id === link.id);
                const keys = matches.filter(entry => entry.groupId === link.id).map(entry => entry.id);
                const heading = html`<div class="space-y-2"><div class="flex flex-wrap items-center gap-2"><h2 class="text-lg font-semibold">${link.label}</h2>
                    ${group?.plugin ? component(Badge, { variant: group.active ? 'success' : 'secondary' }, group.active ? __('Enabled') : __('Disabled')) : null}</div>
                    ${group?.description ? html`<p class="text-sm text-muted-foreground">${group.description}</p>` : null}
                    ${group?.plugin ? html`<p class="text-xs text-muted-foreground">${group.plugin}</p>` : null}
                    ${group?.theme ? html`<a href="/dashboard/appearance/customize" class="text-sm text-primary hover:underline">${__('Theme customization')}</a>` : null}</div>`;
                return component(SettingsSection, { id: link.id, heading, count: keys.length, onConnect: this.trackSection, eager: !keys.length || link.id === this.target || link.id === ordered[0]?.id,
                    content: () => link.id === 'languages' && this.view.languages ? component(LanguagesSettings, { draft: this.draft, initial: this.view.languages, fields: keys, onSave: this.saveLanguages })
                        : link.id === 'permalinks' && this.view.permalinks ? component(PermalinksSettings, { draft: this.draft, initial: this.view.permalinks, fields: keys, onSave: this.savePermalinks })
                        : group && keys.length ? this.groupContent(group, fields, blocked) : html`` });
            })}
        </div>`, { entries: this.view.entries, query: this.draft.search, onNavigate: this.openSection });
    }
}
