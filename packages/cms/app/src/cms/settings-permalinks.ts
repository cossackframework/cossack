/** The permalink form used by the unified Settings page. */
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import { Button } from '@cossackframework/ui';
import { component, html } from '@cossackframework/renderer';
import { isCmsError, type Principal } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import type { SettingsDraft } from './settings-draft';
import { CONTROL, notice } from './ui';

interface Base { name: string; label: string; singular: string; path: string }
export interface PermalinkSettingsInput { postsAtRoot: boolean; postsBase: string; withCategory: boolean; bases: { name: string; path: string }[] }
export interface PermalinkSettingsData extends PermalinkSettingsInput { taxonomies: Base[]; origin: string }
export interface PermalinkSettingsResult { data: PermalinkSettingsData | null; error: string; fields: Record<string, string> }
const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

export function loadPermalinkSettings(cms: CmsHost, origin: string): PermalinkSettingsData {
    const posts = cms.collections().find(collection => collection.name === 'posts');
    const taxonomies = cms.taxonomies.declarations.filter(taxonomy => taxonomy.path).map(taxonomy => ({ name: taxonomy.name, label: taxonomy.label, singular: taxonomy.singular, path: taxonomy.path! }));
    return { postsAtRoot: posts?.path === '', postsBase: posts?.path || 'posts', withCategory: posts?.permalink === 'category', taxonomies, origin,
        bases: taxonomies.map(({ name, path }) => ({ name, path })) };
}

/** Called by the authorized page; CmsHost also checks schema-edit permissions. */
export async function savePermalinkSettings(cms: CmsHost, principal: Principal, input: PermalinkSettingsInput, origin: string): Promise<PermalinkSettingsResult> {
    const fields: Record<string, string> = {};
    try {
        if (!input || typeof input.postsAtRoot !== 'boolean' || typeof input.postsBase !== 'string' || typeof input.withCategory !== 'boolean' || !Array.isArray(input.bases)
            || input.bases.some(entry => !entry || typeof entry.name !== 'string' || typeof entry.path !== 'string')) return { data: null, error: __('The permalink settings are invalid.'), fields };
        const base = input.postsBase.trim().replace(/^\/+|\/+$/g, '');
        if (!input.postsAtRoot && !SEGMENT.test(base)) fields.posts = __('Use lowercase letters, digits, hyphens and slashes.');
        for (const entry of input.bases) if (!SEGMENT.test(entry.path.trim()) || entry.path.includes('/')) fields[entry.name] = __('Use lowercase letters, digits and hyphens.');
        if (Object.keys(fields).length) return { data: null, error: __('Some permalinks are invalid.'), fields };
        const posts = cms.collection('posts');
        const path = input.postsAtRoot ? '' : base;
        const permalink = input.withCategory && posts.taxonomies?.length ? 'category' as const : 'slug' as const;
        if (posts.path !== path || (posts.permalink ?? 'slug') !== permalink) await cms.saveCollection({ ...posts, path, permalink }, principal);
        for (const entry of input.bases) {
            const taxonomy = cms.taxonomies.declaration(entry.name);
            if (taxonomy.path !== entry.path.trim()) await cms.saveTaxonomy({ ...taxonomy, path: entry.path.trim() }, principal);
        }
        return { data: loadPermalinkSettings(cms, origin), error: '', fields };
    } catch (error) { return { data: null, error: isCmsError(error) ? error.message : __('The permalinks could not be saved.'), fields }; }
}

export type PermalinksSettingsProps = {
    draft: SettingsDraft;
    initial: PermalinkSettingsData;
    fields?: readonly string[];
    onSave(input: PermalinkSettingsInput): Promise<PermalinkSettingsResult>;
};

const permalinkDraft = (data: PermalinkSettingsData): PermalinkSettingsInput => ({ postsAtRoot: data.postsAtRoot, postsBase: data.postsBase, withCategory: data.withCategory, bases: data.bases.map(base => ({ ...base })) });

@Component()
export class PermalinksSettings extends Cossack {
    declare props: PermalinksSettingsProps;
    @ClientState() private revision = 0;
    @ClientState() private error = '';
    @ClientState() private errors: Record<string, string> = {};
    @ClientState() private message = '';
    private unsubscribe?: () => void;

    onMount() {
        this.props.draft.initializeSection('permalinks', permalinkDraft(this.props.initial));
        this.unsubscribe = this.props.draft.subscribe(() => { this.revision++; });
    }

    onCleanup() { this.unsubscribe?.(); }

    @Client()
    set(patch: Partial<PermalinkSettingsInput>) {
        const current = this.props.draft.section('permalinks', permalinkDraft(this.props.initial));
        this.props.draft.setSection('permalinks', { ...current, ...patch });
        this.error = '';
        this.errors = {};
        this.message = '';
    }

    @Client()
    setBase(name: string, path: string) {
        const current = this.props.draft.section('permalinks', permalinkDraft(this.props.initial));
        this.set({ bases: current.bases.map(base => base.name === name ? { ...base, path } : base) });
    }

    @Client()
    discard() { this.props.draft.discardSection('permalinks'); this.error = ''; this.errors = {}; this.message = ''; }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        this.error = '';
        this.errors = {};
        this.message = '';
        try {
            const result = await this.props.onSave(this.props.draft.section('permalinks', permalinkDraft(this.props.initial)));
            this.error = result.error;
            this.errors = result.fields;
            if (result.data) { this.props.draft.acceptSection('permalinks', permalinkDraft(result.data)); this.message = __('Permalink structure updated.'); }
        } catch { this.error = __('The permalinks could not be saved. Your changes are kept.'); }
    }

    render() {
        const form = this.props.draft.section('permalinks', permalinkDraft(this.props.initial));
        const show = (field: string) => !this.props.fields || this.props.fields.includes(`permalinks.${field}`);
        const sample = (base: string) => `${this.props.initial.origin}${base}${form.withCategory ? '/sample-category' : ''}/sample-post`;
        const option = (atRoot: boolean, label: string, example: string) => html`<label class="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-[:checked]:border-primary">
            <input type="radio" name="posts-structure" class="mt-1" .checked=${form.postsAtRoot === atRoot} @change=${() => this.set({ postsAtRoot: atRoot })}>
            <span><span class="block text-sm font-medium text-foreground">${label}</span><code class="break-all text-xs text-muted-foreground">${example}</code></span>
        </label>`;
        const taxonomies = this.props.initial.taxonomies.filter(taxonomy => show(`taxonomy.${taxonomy.name}`));
        return html`<form class="space-y-5" @submit=${this.submit}>
            <p class="text-sm text-muted-foreground">${__('Choose the addresses of posts and archives. Old addresses redirect to the new ones.')}</p>
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            <fieldset class="min-w-0 space-y-5" ?disabled=${!!this.loading.submit}>
                ${show('posts') || show('postsBase') || show('category') ? html`<fieldset id="permalink-posts" class="min-w-0 space-y-3">
                    <legend class="mb-2 text-base font-semibold text-foreground">${__('Post permalinks')}</legend>
                    ${show('posts') || show('postsBase') ? html`${option(true, __('Post name'), sample(''))}${option(false, __('Under a base'), sample(`/${form.postsBase.trim() || 'posts'}`))}` : null}
                    ${show('category') ? html`<label class="flex cursor-pointer items-start gap-3 text-sm text-foreground">
                        <input id="permalink-category" type="checkbox" class="mt-1" .checked=${form.withCategory} @change=${(event: Event) => this.set({ withCategory: (event.target as HTMLInputElement).checked })}>
                        <span><span class="block font-medium">${__('Category before the post name')}</span>
                            <span class="text-xs text-muted-foreground">${__('Use the first category before the post name. Posts without a category keep the plain address.')}</span></span>
                    </label>` : null}
                    ${(show('posts') || show('postsBase')) && !form.postsAtRoot ? html`<div class="space-y-1"><label for="posts-base" class="block text-sm font-medium text-foreground">${__('Posts base')}</label>
                        <input id="posts-base" class=${CONTROL} .value=${form.postsBase} @input=${(event: Event) => this.set({ postsBase: (event.target as HTMLInputElement).value })}>
                        ${this.errors.posts ? html`<p role="alert" class="text-xs text-destructive">${this.errors.posts}</p>` : null}
                    </div>` : null}
                </fieldset>` : null}
                ${taxonomies.length ? html`<fieldset class="min-w-0 space-y-3">
                    <legend class="mb-2 text-base font-semibold text-foreground">${__('Archive bases')}</legend>
                    ${taxonomies.map(taxonomy => {
                        const path = form.bases.find(base => base.name === taxonomy.name)?.path ?? taxonomy.path;
                        return html`<div class="space-y-1">
                            <label for=${`base-${taxonomy.name}`} class="block text-sm font-medium text-foreground">${taxonomy.singular} ${__('base')}</label>
                            <input id=${`base-${taxonomy.name}`} class=${CONTROL} .value=${path} @input=${(event: Event) => this.setBase(taxonomy.name, (event.target as HTMLInputElement).value)}>
                            <p class="break-all text-xs text-muted-foreground"><code>${this.props.initial.origin}/${path || '…'}/sample-${taxonomy.singular.toLowerCase()}</code></p>
                            ${this.errors[taxonomy.name] ? html`<p role="alert" class="text-xs text-destructive">${this.errors[taxonomy.name]}</p>` : null}
                        </div>`;
                    })}
                </fieldset>` : null}
            </fieldset>
            <div class="flex flex-wrap gap-3">
                ${component(Button, { type: 'submit', disabled: !!this.loading.submit || !this.props.draft.sectionDirty('permalinks') }, __('Save permalinks'))}
                ${component(Button, { type: 'button', variant: 'outline', disabled: !!this.loading.submit || !this.props.draft.sectionDirty('permalinks'), '@click': this.discard }, __('Discard permalink changes'))}
            </div>
        </form>`;
    }
}
