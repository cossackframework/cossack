import { Client, ClientState, Cossack, Inject, OnDocument, OnWindow, Page, PreventNavigation, Server, Shared, server$, type HeadValue } from '@cossackframework/core';
import { Badge, Card, CardBody } from '@cossackframework/ui';
import { component, html, repeat, type TemplateResult } from '@cossackframework/renderer';
import { hasPermission, isCmsError, isNetworkAdmin, MAIN_SITE, PERMISSIONS, type SettingsDocument, type SettingsSection as SectionDeclaration } from '@cossackframework/cms';
import { requireAny } from '../../../../cms/guards';
import { SettingsDraft, settingsNavigation } from '../../../../cms/settings-draft';
import { findSettingsMedia, settingControl, settingInput, settingRows, settingsEditorSnapshot, type ChoiceCache, type SettingRow, type SettingValue, type SettingValues } from '../../../../cms/settings-form';
import { filterSettingsLinks, settingsErrorSummary, settingsFrame, settingsLinks, type SettingsLink } from '../../../../cms/settings-nav';
import { searchSettings, settingsSearchEntries, settingsSectionId, type SettingsSearchEntry } from '../../../../cms/settings-search';
import { SettingsSection } from '../../../../cms/settings-section';
import { activeSettingsSection } from '../../../../cms/settings-scroll';
import { languageDraft, languageInput, LanguagesSettings, loadLanguageSettings, saveLanguageSettings, type LanguageSettingsData, type LanguageSettingsInput } from '../../../../cms/settings-languages';
import { PermalinksSettings, loadPermalinkSettings, permalinkDraft, savePermalinkSettings, type PermalinkSettingsData, type PermalinkSettingsInput } from '../../../../cms/settings-permalinks';
import { NetworkSettingsForm, loadNetworkSettings, networkDraft, saveNetworkSettings, type NetworkSettingsData, type NetworkSettingsInput } from '../../../../cms/settings-network';
import { notice } from '../../../../cms/ui';

interface GroupView {
    id: string; label: string; description: string; plugin: string; active: boolean; theme: boolean; portable: boolean;
    sections: readonly SectionDeclaration[]; rows: SettingRow[]; values: SettingValues;
}
/** Everything the toolbar's Save sends: the portable document and the sections saved by their own operations. */
interface SaveInput {
    document: SettingsDocument | null;
    languages: LanguageSettingsInput | null;
    permalinks: PermalinkSettingsInput | null;
    network: NetworkSettingsInput | null;
    groups: Record<string, SettingValues>;
}
/** What was saved, in order; the first part that fails stops the rest and names its section. */
interface SaveResult {
    document: SettingsDocument | null; languages: LanguageSettingsData | null; permalinks: PermalinkSettingsData | null; network: NetworkSettingsData | null; groups: string[];
    error: string; fields: Record<string, string>;
}
interface SettingsView {
    links: SettingsLink[]; entries: SettingsSearchEntry[]; groups: GroupView[];
    canUpload: boolean; canBrowse: boolean;
    snapshot: SettingsDocument; invalid: Record<string, string>; languages: LanguageSettingsData | null; permalinks: PermalinkSettingsData | null;
    /** The Network section: for network admins, on the main site. */
    network: NetworkSettingsData | null;
}

/** One document of settings. The menu and visible fields use the same search matches. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSettings)] })
export default class SettingsPage extends Cossack {
    @Inject(SettingsDraft) private draft!: SettingsDraft;
    view: SettingsView = server$(async (): Promise<SettingsView> => {
        const cms = this.c.get('cms'), principal = this.c.get('principal');
        const origin = new URL(this.c.req.url).origin;
        const portable = new Set(cms.settings.catalog({ principal }).map(group => group.id));
        const network = this.managesNetwork();
        // The whole page in one round of reads: the groups share each choice source (roles, pages,
        // categories are read once), and the plugin status, the snapshot and the other sections load alongside.
        const choices: ChoiceCache = new Map();
        const [status, snapshot, languages, networkData, rows] = await Promise.all([
            cms.status(), settingsEditorSnapshot(cms, principal), loadLanguageSettings(cms, origin), network ? loadNetworkSettings(this.c.get('network')) : Promise.resolve(null),
            Promise.all(cms.settings.groups.filter(group => group.id !== 'languages' && (group.permission ?? PERMISSIONS.manageSettings) === PERMISSIONS.manageSettings).map(async group => ({
                id: group.id, label: group.label, description: group.description ?? '', plugin: group.plugin ?? '',
                theme: cms.themes().some(theme => theme.name === group.plugin), portable: portable.has(group.id),
                sections: group.sections ?? [], ...await settingRows(cms, group, principal, choices),
            }))),
        ]);
        const groups: GroupView[] = rows.map(group => ({ ...group, active: status.plugins.find(plugin => plugin.name === group.plugin)?.active ?? false }));
        return { links: settingsLinks(cms, { network }), entries: settingsSearchEntries(cms, { network }), groups, snapshot: snapshot.document, invalid: snapshot.errors,
            canUpload: !!cms.files && hasPermission(principal, PERMISSIONS.upload),
            canBrowse: !!cms.files && [PERMISSIONS.upload, PERMISSIONS.manageMedia, PERMISSIONS.manageUsers].some(permission => hasPermission(principal, permission)),
            languages, permalinks: loadPermalinkSettings(cms, origin), network: networkData };
    }, { initial: { links: [], entries: [], groups: [], canUpload: false, canBrowse: false, snapshot: {}, invalid: {}, languages: null, permalinks: null, network: null } });
    @ClientState() message = '';
    @ClientState() error = '';
    @ClientState() errors: Record<string, string> = {};
    @ClientState() revision = 0;
    @ClientState() target = 'general';
    @ClientState() active = 'general';
    private unsubscribe?: () => void;
    private discards = 0;
    private sectionElements = new Map<string, Element>();
    private scrollFrame?: number;
    /** The section being scrolled to: kept under the toolbar until the page above it stops changing size, then let go. */
    private pendingTarget?: string;
    private settleDeadline = 0;
    private settleQuiet?: ReturnType<typeof setTimeout>;
    private settle?: ResizeObserver;
    private sectionsContainer?: Element;

    head(): HeadValue { return { title: __('Settings') }; }

    /** The network's settings belong to network admins, on its main site. Server only. */
    private managesNetwork(): boolean {
        return isNetworkAdmin(this.c.get('principal')) && this.c.get('site')?.id === MAIN_SITE;
    }

    onMount() {
        this.draft.initialize(this.view.snapshot, this.view.invalid);
        this.draft.navigated(window.location.pathname);
        for (const group of this.view.groups.filter(group => !group.portable)) this.draft.initializeSection(group.id, group.values);
        this.discards = this.draft.discards;
        this.unsubscribe = this.draft.subscribe(() => {
            // The toolbar's Discard also clears what the last save reported.
            if (this.draft.discards !== this.discards) { this.discards = this.draft.discards; this.error = ''; this.message = ''; this.errors = {}; }
            this.revision++; this.updateActiveSection();
        });
        this.revealHash();
        this.updateActiveSection();
    }

    onCleanup() { this.pendingTarget = undefined; clearTimeout(this.settleQuiet); this.settle?.disconnect(); this.unsubscribe?.(); if (this.scrollFrame !== undefined) cancelAnimationFrame(this.scrollFrame); }

    /** The user took over the scrolling: the section being scrolled to is let go. */
    @OnWindow('wheel')
    @OnWindow('touchstart')
    @OnWindow('pointerdown')
    @OnWindow('keydown')
    @Client()
    cancelSectionJump() {
        if (!this.pendingTarget) return;
        this.pendingTarget = undefined;
        clearTimeout(this.settleQuiet);
        this.updateActiveSection();
    }

    /**
     * Scroll a section under the toolbar. Every section is on the page at once, but the controls
     * inside them render after their section connects (nested components), so the page above the
     * section grows for a moment: the section is kept in place while the sections' container
     * changes size, until it has been quiet for a moment, at most two seconds. A section that has
     * not connected yet (the hash's, as the page arrives after a client navigation) is scrolled to
     * when it does.
     */
    @Client()
    async scrollToSection(id: string) {
        this.pendingTarget = id;
        this.settleDeadline = performance.now() + 2000;
        await this.requestUpdate();
        this.realign();
    }

    /** Put the pending section under the toolbar (again). */
    @Client()
    private realign() {
        const element = this.pendingTarget ? this.sectionElements.get(this.pendingTarget) : undefined;
        if (!element) return;
        element.scrollIntoView({ block: 'start', behavior: 'instant' });
        clearTimeout(this.settleQuiet);
        this.settleQuiet = setTimeout(() => { this.pendingTarget = undefined; this.updateActiveSection(); }, Math.max(0, Math.min(150, this.settleDeadline - performance.now())));
        this.updateActiveSection();
    }

    /** The sections' container: its size changes while the page settles after a scroll. */
    @Client()
    trackContainer(element: Element | undefined) {
        if (element === this.sectionsContainer) return;
        this.settle?.disconnect();
        this.sectionsContainer = element;
        if (element && typeof ResizeObserver !== 'undefined') {
            this.settle = new ResizeObserver(() => this.realign());
            this.settle.observe(element);
        }
    }

    @Client()
    trackSection(id: string, element: Element | undefined) {
        const previous = this.sectionElements.get(id);
        if (previous === element) return;
        if (element) this.sectionElements.set(id, element);
        else this.sectionElements.delete(id);
        if (element && this.pendingTarget === id) this.realign();
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

    /**
     * Scroll to the section the address names (`#settings-<group>`): on mount, when the address
     * changes, and when a client navigation completes (`cossack:ready`): at mount the router has
     * not committed the address yet, and its own scroll to the fragment lands before the sections'
     * controls have rendered. The section is scrolled to when it connects (`trackSection`) and
     * kept in place while the page settles.
     */
    @OnWindow('hashchange')
    @OnDocument('cossack:ready')
    @Client()
    async revealHash() {
        let anchor = window.location.hash.slice(1);
        try { anchor = decodeURIComponent(anchor); } catch { return; }
        if (!anchor.startsWith('settings-')) return;
        let id = '';
        try { id = decodeURIComponent(anchor.slice('settings-'.length)); } catch { return; }
        if (!id) return;
        this.target = id;
        await this.scrollToSection(id);
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
        if (this.draft.saving || this.draft.jsonError || Object.keys(this.draft.errors).length || this.draft.preview?.imported || !this.draft.dirty()) return;
        const changes = this.draft.changes();
        const languages = this.view.languages && this.draft.sectionDirty('languages') ? languageInput(this.draft, this.view.languages) : null;
        const permalinks = this.view.permalinks && this.draft.sectionDirty('permalinks') ? this.draft.section('permalinks', permalinkDraft(this.view.permalinks)) : null;
        const network = this.view.network && this.draft.sectionDirty('network') ? this.draft.section('network', networkDraft(this.view.network)) : null;
        const groups = Object.fromEntries(this.view.groups.filter(group => !group.portable && this.draft.sectionDirty(group.id)).map(group => [group.id, this.draft.section(group.id, group.values)]));
        this.draft.setSaving(true);
        try {
            const result = await this.saveAll({ document: Object.keys(changes).length ? changes : null, languages, permalinks, network, groups });
            if (result.document) this.draft.accept(result.document);
            if (result.languages) this.draft.acceptSection('languages', languageDraft(result.languages));
            if (result.permalinks) this.draft.acceptSection('permalinks', permalinkDraft(result.permalinks));
            if (result.network) this.draft.acceptSection('network', networkDraft(result.network));
            // Network appears in, or leaves, the dashboard menu.
            if (result.network && result.network.enabled !== this.view.network?.enabled && !result.error) { window.location.reload(); return; }
            // Interface settings restyle the dashboard itself (palettes, icon sprites): show them at once.
            if (changes.interface && result.document && !result.error) { window.location.reload(); return; }
            for (const id of result.groups) this.draft.acceptSection(id, groups[id]);
            this.error = result.error; this.errors = result.fields;
            if (!result.error) this.message = __('Settings saved.');
        } catch { this.error = __('The settings could not be saved. Your draft is kept.'); }
        finally { this.draft.setSaving(false); }
    }

    @Server()
    async findMedia(search: string, kind: string) { return findSettingsMedia(this.c.get('cms'), this.c.get('principal'), search, kind); }

    /** One save for the whole page: the document first, then Languages, Permalinks, Network and the groups outside the document. */
    @Server()
    async saveAll(input: SaveInput): Promise<SaveResult> {
        const cms = this.c.get('cms'), principal = this.c.get('principal'), origin = new URL(this.c.req.url).origin;
        const result: SaveResult = { document: null, languages: null, permalinks: null, network: null, groups: [], error: '', fields: {} };
        const failed = (section: string, error: string, fields: Record<string, string> = {}) => ({ ...result, error: `${section}: ${error}`, fields });
        if (input.document) {
            try { result.document = await cms.settings.applyDocument(input.document, { principal }); }
            catch (error) { return { ...result, error: isCmsError(error) ? error.message : __('The settings could not be saved.'), fields: isCmsError(error) ? { ...error.fields } : {} }; }
        }
        if (input.languages) {
            const saved = await saveLanguageSettings(cms, principal, input.languages, origin);
            if (!saved.data) return failed(__('Languages'), saved.error);
            result.languages = saved.data;
        }
        if (input.permalinks) {
            const saved = await savePermalinkSettings(cms, principal, input.permalinks, origin);
            if (!saved.data) return failed(__('Permalinks'), saved.error, Object.fromEntries(Object.entries(saved.fields).map(([name, error]) => [`permalinks.${name}`, error])));
            result.permalinks = saved.data;
        }
        if (input.network) {
            if (!this.managesNetwork()) return failed(__('Network'), __('Only network admins change the network, on its main site.'));
            const saved = await saveNetworkSettings(this.c.get('network'), principal, input.network);
            if (!saved.data) return failed(__('Network'), saved.error, Object.fromEntries(Object.entries(saved.fields).map(([name, error]) => [`network.${name}`, error])));
            result.network = saved.data;
        }
        for (const [id, values] of Object.entries(input.groups ?? {})) {
            const group = cms.settings.groups.find(group => group.id === id && !group.plugin && group.id !== 'languages' && (group.permission ?? PERMISSIONS.manageSettings) === PERMISSIONS.manageSettings);
            if (!group) return failed(id, __('These settings do not exist.'));
            const { input: valid, errors } = settingInput(group, values);
            if (Object.keys(errors).length) return failed(group.label, __('Some settings are invalid.'), Object.fromEntries(Object.entries(errors).map(([name, value]) => [`${id}.${name}`, value])));
            try { await cms.settings.update(id, valid, { principal }); }
            catch (error) { return failed(group.label, isCmsError(error) ? error.message : __('The settings could not be saved.'), isCmsError(error) ? Object.fromEntries(Object.entries(error.fields ?? {}).map(([name, value]) => [`${id}.${name}`, value])) : {}); }
            result.groups.push(id);
        }
        return result;
    }

    @Shared()
    groupContent(group: GroupView, fields: Set<string>, blocked: boolean): TemplateResult {
        const controls = html`<fieldset class="min-w-0 space-y-5" ?disabled=${this.draft.saving || (group.portable && blocked)}>
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
        return component(Card, group.plugin ? { 'data-plugin-settings': group.plugin } : {}, component(CardBody, {}, controls));
    }

    render() {
        const matches = searchSettings(this.view.entries, this.draft.search);
        const fields = new Set(matches.map(entry => entry.id));
        const blocked = !!this.draft.jsonError || !!this.draft.preview?.imported;
        const ordered = filterSettingsLinks(this.view.links, this.view.entries, this.draft.search);
        const permalinkErrors = Object.fromEntries(Object.entries(this.errors).filter(([key]) => key.startsWith('permalinks.')).map(([key, error]) => [key.slice(11), error]));
        const networkErrors = Object.fromEntries(Object.entries(this.errors).filter(([key]) => key.startsWith('network.')).map(([key, error]) => [key.slice(8), error]));
        return settingsFrame(this.view.links, this.active, html`<div class="min-w-0 space-y-8" ref=${this.trackContainer}>
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
                return component(SettingsSection, { id: link.id, heading, onConnect: this.trackSection,
                    content: () => link.id === 'languages' && this.view.languages ? component(LanguagesSettings, { draft: this.draft, initial: this.view.languages, fields: keys })
                        : link.id === 'permalinks' && this.view.permalinks ? component(PermalinksSettings, { draft: this.draft, initial: this.view.permalinks, fields: keys, errors: permalinkErrors })
                        : link.id === 'network' && this.view.network ? component(NetworkSettingsForm, { draft: this.draft, initial: this.view.network, fields: keys, errors: networkErrors })
                        : group && keys.length ? this.groupContent(group, fields, blocked) : html`` });
            })}
        </div>`, { entries: this.view.entries, query: this.draft.search, onNavigate: this.openSection });
    }
}
