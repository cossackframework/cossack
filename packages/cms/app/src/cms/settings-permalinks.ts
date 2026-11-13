/** The permalink form used by the unified Settings page. */
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import { Checkbox, Field, Input } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, type Principal } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import type { SettingsDraft } from './settings-draft';


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
    /** Field problems from the last save, by field name. */
    errors?: Readonly<Record<string, string>>;
};

export const permalinkDraft = (data: PermalinkSettingsData): PermalinkSettingsInput => ({ postsAtRoot: data.postsAtRoot, postsBase: data.postsBase, withCategory: data.withCategory, bases: data.bases.map(base => ({ ...base })) });

@Component()
export class PermalinksSettings extends Cossack {
    declare props: PermalinksSettingsProps;
    @ClientState() private revision = 0;
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
    }

    @Client()
    setBase(name: string, path: string) {
        const current = this.props.draft.section('permalinks', permalinkDraft(this.props.initial));
        this.set({ bases: current.bases.map(base => base.name === name ? { ...base, path } : base) });
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
        const errors = this.props.errors ?? {};
        return html`<div class="space-y-5">
            <p class="text-sm text-muted-foreground">${__('Choose the addresses of posts and archives. Old addresses redirect to the new ones.')}</p>
            <fieldset class="min-w-0 space-y-5" ?disabled=${this.props.draft.saving}>
                ${show('posts') || show('postsBase') || show('category') ? html`<fieldset id="permalink-posts" class="min-w-0 space-y-3">
                    <legend class="mb-2 text-base font-semibold text-foreground">${__('Post permalinks')}</legend>
                    ${show('posts') || show('postsBase') ? html`${option(true, __('Post name'), sample(''))}${option(false, __('Under a base'), sample(`/${form.postsBase.trim() || 'posts'}`))}` : null}
                    ${show('category') ? component(Checkbox, { id: 'permalink-category', checked: form.withCategory, '@change': (event: Event) => this.set({ withCategory: (event.target as HTMLInputElement).checked }) },
                        html`<span><span class="block font-medium">${__('Category before the post name')}</span>
                            <span class="text-xs text-muted-foreground">${__('Use the first category before the post name. Posts without a category keep the plain address.')}</span></span>`) : null}
                    ${(show('posts') || show('postsBase')) && !form.postsAtRoot ? component(Field, { label: __('Posts base'), for: 'posts-base', ...(errors.posts ? { error: errors.posts } : {}),
                        control: attributes => component(Input, { ...attributes, '.value': form.postsBase, '@input': (event: Event) => this.set({ postsBase: (event.target as HTMLInputElement).value }) }) }) : null}
                </fieldset>` : null}
                ${taxonomies.length ? html`<fieldset class="min-w-0 space-y-3">
                    <legend class="mb-2 text-base font-semibold text-foreground">${__('Archive bases')}</legend>
                    ${taxonomies.map(taxonomy => {
                        const path = form.bases.find(base => base.name === taxonomy.name)?.path ?? taxonomy.path;
                        return component(Field, { label: `${taxonomy.singular} ${__('base')}`, for: `base-${taxonomy.name}`, hint: `${this.props.initial.origin}/${path || '…'}/sample-${taxonomy.singular.toLowerCase()}`,
                            ...(errors[taxonomy.name] ? { error: errors[taxonomy.name] } : {}), class: 'min-w-0 [&_.cs-field__hint]:break-all [&_.cs-field__hint]:font-mono',
                            control: attributes => component(Input, { ...attributes, '.value': path, '@input': (event: Event) => this.setBase(taxonomy.name, (event.target as HTMLInputElement).value) }) });
                    })}
                </fieldset>` : null}
            </fieldset>
        </div>`;
    }
}
