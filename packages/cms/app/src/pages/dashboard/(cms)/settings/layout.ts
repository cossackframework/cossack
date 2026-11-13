import { Client, ClientState, Cossack, Inject, Page } from '@cossackframework/core';
import { Button, Icon, Input } from '@cossackframework/ui';
import { component, html } from '@cossackframework/renderer';
import { PERMISSIONS } from '@cossackframework/cms';
import { requireAny } from '../../../../cms/guards';
import { icon } from '../../../../cms/icons';
import { SettingsDraft, settingsNavigation } from '../../../../cms/settings-draft';

/** This scope survives Settings navigation and disposes its client draft on exit. */
@Page({ transport: 'http', services: [SettingsDraft], middlewares: [requireAny(PERMISSIONS.manageSettings)] })
export default class SettingsLayout extends Cossack {
    @Inject(SettingsDraft) private draft!: SettingsDraft;
    @ClientState() revision = 0;
    private unsubscribe?: () => void;
    private toolbar?: HTMLElement;
    private resize?: ResizeObserver;

    onMount() { this.draft.navigated(window.location.pathname); this.unsubscribe = this.draft.subscribe(() => { this.revision++; }); }
    onCleanup() { this.unsubscribe?.(); this.resize?.disconnect(); }

    @Client()
    connectToolbar(element: HTMLElement | undefined) {
        if (element === this.toolbar) return;
        this.resize?.disconnect();
        this.toolbar = element;
        if (!element) return;
        const measure = () => this.draft.setToolbarHeight(Math.ceil(element.getBoundingClientRect().height));
        measure();
        if (typeof ResizeObserver !== 'undefined') { this.resize = new ResizeObserver(measure); this.resize.observe(element); }
    }

    @Client()
    discard() { if (!this.draft.saving) this.draft.discard(); }

    @Client()
    searchKey(event: KeyboardEvent) {
        if (event.key === 'Escape') { this.draft.setSearch(''); event.preventDefault(); }
    }

    render() {
        const json = this.isActive('/dashboard/settings/json');
        const preview = json ? this.draft.preview : null;
        const blocked = !!this.draft.jsonError || Object.keys(this.draft.errors).length > 0 || (!json && !!this.draft.preview?.imported);
        return html`<div data-subnav class="flex min-h-screen min-w-0 flex-col" style=${`--settings-toolbar-height:${this.draft.toolbarHeight}px`}>
            <header ref=${this.connectToolbar} data-settings-toolbar class="sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-3 md:flex-nowrap md:gap-0 md:px-0 md:py-0">
                <h1 class="w-full shrink-0 text-sm font-semibold md:w-52 md:px-4">${__('Settings')}</h1>
                <div class="flex min-w-0 basis-full flex-wrap items-center gap-2 py-1 md:flex-1 md:basis-auto md:px-6">
                    <div class="min-w-36 flex-1" @keydown=${this.searchKey}>
                        ${component(Input, { type: 'search', 'aria-label': __('Search settings'), placeholder: __('Search settings'),
                            '.value': this.draft.search, '@input': (event: Event) => this.draft.setSearch((event.target as HTMLInputElement).value) })}
                    </div>
                    <a href="/dashboard/settings/json" @click=${settingsNavigation} aria-label=${__('Edit settings JSON')} title=${__('Edit settings JSON')}
                        aria-current=${json ? 'page' : 'false'}
                        class=${`inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border no-underline hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring ${json ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>
                        <span aria-hidden="true">${component(Icon, { entry: icon('code-square'), size: 18 })}</span>
                    </a>
                    <div class="ms-auto flex shrink-0 items-center gap-2" data-settings-actions>
                        ${this.draft.dirty() ? component(Button, { type: 'button', variant: 'outline', disabled: this.draft.saving, '@click': this.discard }, __('Discard changes')) : null}
                        ${component(Button, { type: 'submit', form: 'settings-actions', disabled: this.draft.saving || blocked || (preview ? !Object.keys(preview.patch).length : json ? !this.draft.documentDirty() : !this.draft.dirty()) },
                            this.draft.saving ? __('Working…') : json ? preview ? __('Apply changes') : __('Preview changes') : __('Save changes'))}
                    </div>
                </div>
            </header>
            ${this.children}
        </div>`;
    }
}
