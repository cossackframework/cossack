import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, toast } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, PERMISSIONS } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { settingsFrame, settingsLinks, type SettingsLink } from '../../../../../cms/settings-nav';
import { CONTROL, notice, pageHeader } from '../../../../../cms/ui';

interface Base { name: string; label: string; singular: string; path: string }

const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

/**
 * Permalinks, as in WordPress: posts at the site root (/sample-post) or under a base
 * (/posts/sample-post), and the bases of term archives. Each choice is saved to the
 * collection or taxonomy it belongs to.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSettings)] })
export default class PermalinksPage extends Cossack {
    @State() links: SettingsLink[] = [];
    @State() postsAtRoot = false;
    @State() postsBase = 'posts';
    /** The first category's slug before the post name, as /%category%/%postname%/ in WordPress. */
    @State() withCategory = false;
    @State() categoryBase = 'category';
    @State() taxonomies: Base[] = [];
    @State() origin = '';
    @State() errors: Record<string, string> = {};
    @State() error = '';

    head(): HeadValue {
        return { title: __('Permalink settings') };
    }

    async init() {
        const cms = this.c.get('cms');
        this.origin = new URL(this.c.req.url).origin;
        this.links = settingsLinks(cms);
        this.load();
    }

    @Server()
    load() {
        const cms = this.c.get('cms');
        const posts = cms.collections().find(collection => collection.name === 'posts');
        this.postsAtRoot = posts?.path === '';
        this.postsBase = posts?.path || 'posts';
        this.withCategory = posts?.permalink === 'category';
        this.categoryBase = posts?.taxonomies?.[0] ? cms.taxonomies.declarations.find(taxonomy => taxonomy.name === posts.taxonomies![0])?.path || 'category' : 'category';
        this.taxonomies = cms.taxonomies.declarations.filter(taxonomy => taxonomy.path).map(taxonomy => ({ name: taxonomy.name, label: taxonomy.label, singular: taxonomy.singular, path: taxonomy.path! }));
    }

    @Client()
    setBase(name: string, path: string) {
        this.taxonomies = this.taxonomies.map(taxonomy => taxonomy.name === name ? { ...taxonomy, path } : taxonomy);
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.save(this.postsAtRoot, this.postsBase, this.taxonomies.map(taxonomy => ({ name: taxonomy.name, path: taxonomy.path })), this.withCategory);
        if (this.error) toast.error(this.error); else toast.success(__('Permalink structure updated.'));
    }

    @Server()
    async save(postsAtRoot: boolean, postsBase: string, bases: { name: string; path: string }[], withCategory = false) {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        this.error = '';
        this.errors = {};
        const base = postsBase.trim().replace(/^\/+|\/+$/g, '');
        if (!postsAtRoot && !SEGMENT.test(base)) this.errors = { ...this.errors, posts: __('Use lowercase letters, digits, hyphens and slashes.') };
        for (const entry of bases) if (!SEGMENT.test(entry.path.trim()) || entry.path.includes('/')) this.errors = { ...this.errors, [entry.name]: __('Use lowercase letters, digits and hyphens.') };
        if (Object.keys(this.errors).length) { this.error = __('Some permalinks are invalid.'); return; }
        try {
            const posts = cms.collection('posts');
            const path = postsAtRoot ? '' : base;
            const permalink = withCategory && posts.taxonomies?.length ? 'category' as const : 'slug' as const;
            if (posts.path !== path || (posts.permalink ?? 'slug') !== permalink) await cms.saveCollection({ ...posts, path, permalink }, principal);
            for (const entry of bases) {
                const taxonomy = cms.taxonomies.declaration(entry.name);
                if (taxonomy.path !== entry.path.trim()) await cms.saveTaxonomy({ ...taxonomy, path: entry.path.trim() }, principal);
            }
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The permalinks could not be saved.');
        }
        this.load();
    }

    render() {
        const option = (atRoot: boolean, label: string, example: string) => html`<label class="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-[:checked]:border-primary">
            <input type="radio" name="posts-structure" class="mt-1" .checked=${this.postsAtRoot === atRoot} @change=${() => { this.postsAtRoot = atRoot; }}>
            <span><span class="block text-sm font-medium text-foreground">${label}</span><code class="text-xs text-muted-foreground">${example}</code></span>
        </label>`;
        const sample = (base: string) => `${this.origin}${base}${this.withCategory ? '/sample-category' : ''}/sample-post`;
        return settingsFrame(this.links, 'permalinks', html`<div class="space-y-6">
            ${pageHeader(__('Permalink settings'), { description: __('Choose how the addresses of posts and archives look. Pages always use their own and their parents’ slugs. Old addresses keep working: they redirect to the new ones.') })}
            ${this.error ? notice(this.error, 'error') : null}
            ${component(Card, {}, component(CardBody, {}, html`<form class="space-y-6" @submit=${(event: Event) => this.submit(event)}>
                <fieldset class="space-y-3">
                    <legend class="mb-2 text-base font-semibold text-foreground">${__('Post permalinks')}</legend>
                    ${option(true, __('Post name'), sample(''))}
                    ${option(false, __('Under a base'), sample(`/${this.postsBase.trim() || 'posts'}`))}
                    <label class="flex cursor-pointer items-start gap-3 text-sm text-foreground">
                        <input type="checkbox" class="mt-1" .checked=${this.withCategory} @change=${(event: Event) => { this.withCategory = (event.target as HTMLInputElement).checked; }}>
                        <span><span class="block font-medium">${__('Category before the post name')}</span>
                            <span class="text-xs text-muted-foreground">${__('The slug of the post’s first category, as WordPress’s %category% does. Posts without a category keep the plain address; moving a post to another category redirects its old address.')}</span></span>
                    </label>
                    ${this.postsAtRoot ? html`<p class="text-xs text-muted-foreground">${__('Post slugs stay unique across pages and the site’s own routes. Choose a posts page under Settings → Reading to list the latest posts.')}</p>`
                        : html`<div class="space-y-1"><label for="posts-base" class="block text-sm font-medium text-foreground">${__('Posts base')}</label>
                            <input id="posts-base" class=${CONTROL} .value=${this.postsBase} @input=${(event: Event) => { this.postsBase = (event.target as HTMLInputElement).value; }}>
                            ${this.errors.posts ? html`<p role="alert" class="text-xs text-destructive">${this.errors.posts}</p>` : null}</div>`}
                </fieldset>
                ${this.taxonomies.length ? html`<fieldset class="space-y-3">
                    <legend class="mb-2 text-base font-semibold text-foreground">${__('Archive bases')}</legend>
                    ${this.taxonomies.map(taxonomy => html`<div class="space-y-1">
                        <label for=${`base-${taxonomy.name}`} class="block text-sm font-medium text-foreground">${taxonomy.singular} ${__('base')}</label>
                        <input id=${`base-${taxonomy.name}`} class=${CONTROL} .value=${taxonomy.path} @input=${(event: Event) => this.setBase(taxonomy.name, (event.target as HTMLInputElement).value)}>
                        <p class="text-xs text-muted-foreground"><code>${this.origin}/${taxonomy.path || '…'}/sample-${taxonomy.singular.toLowerCase()}</code></p>
                        ${this.errors[taxonomy.name] ? html`<p role="alert" class="text-xs text-destructive">${this.errors[taxonomy.name]}</p>` : null}
                    </div>`)}
                </fieldset>` : null}
                <div>${component(Button, { type: 'submit' }, __('Save changes'))}</div>
            </form>`))}
        </div>`);
    }
}
