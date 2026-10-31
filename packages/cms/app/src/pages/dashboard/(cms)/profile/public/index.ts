import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, CardHeader, Field, Input, Textarea, toast } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { AUTHOR_FIELDS, authorUrl, isCmsError } from '@cossackframework/cms';
import { siteOrigin } from '../../../../../cms/seo';
import { notice } from '../../../../../cms/ui';

/** The author profile as the form holds it. */
interface PublicProfile { slug: string; bio: string; jobTitle: string; website: string; profiles: string }

/**
 * The signed-in user's public profile: the author page's address, bio, job title, website
 * and profiles elsewhere. Their articles name them as the author with these, and their author
 * page shows them when Settings → SEO turns author pages on.
 */
@Page({ transport: 'http' })
export default class PublicProfilePage extends Cossack {
    @State() form: PublicProfile = { slug: '', bio: '', jobTitle: '', website: '', profiles: '' };
    @State() authorPages = true;
    @State() origin = '';
    @State() error = '';
    @State() errors: Record<string, string> = {};

    head(): HeadValue {
        return { title: __('Public profile') };
    }

    async init() {
        const cms = this.c.get('cms');
        const user = this.user ? await cms.users.get(this.user.id) : null;
        if (!user) return;
        const meta = user.meta;
        this.form = { slug: user.slug ?? '', bio: String(meta.bio ?? ''), jobTitle: String(meta.jobTitle ?? ''), website: String(meta.website ?? ''), profiles: String(meta.profiles ?? '') };
        this.authorPages = await cms.settings.get('seo.authorPages');
        this.origin = siteOrigin(this.c);
    }

    @Client()
    set<K extends keyof PublicProfile>(key: K, value: PublicProfile[K]) {
        this.form = { ...this.form, [key]: value };
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.save(this.form);
        if (this.error) toast.error(this.error); else toast.success(__('Profile saved.'));
    }

    @Server()
    async save(form: PublicProfile) {
        this.error = '';
        this.errors = {};
        const cms = this.c.get('cms');
        if (!this.user) return;
        const slug = form.slug.trim().toLowerCase();
        if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) { this.errors = { slug: __('uses lowercase letters, digits and hyphens.') }; this.error = __('The address is invalid.'); return; }
        const meta: Record<string, string> = {};
        for (const key of Object.keys(AUTHOR_FIELDS)) meta[key] = String(form[key as keyof PublicProfile] ?? '').trim();
        try {
            await cms.users.update(this.user.id, { meta, ...(slug ? { slug } : {}) });
            const user = await cms.users.get(this.user.id);
            this.form = { ...form, slug: user?.slug ?? slug };
        } catch (error) {
            this.errors = isCmsError(error) && error.fields ? { ...error.fields } : {};
            this.error = isCmsError(error) ? error.message : __('The profile could not be saved.');
        }
    }

    render() {
        const field = (key: keyof PublicProfile, label: string, options: { hint?: string; rows?: number; placeholder?: string } = {}) => component(Field, {
            label, for: `profile-${key}`, ...(options.hint ? { hint: options.hint } : {}), ...(this.errors[key] ? { error: `${label} ${this.errors[key]}` } : {}),
            control: attributes => options.rows
                ? component(Textarea, { ...attributes, rows: options.rows, ...(options.placeholder ? { placeholder: options.placeholder } : {}), '.value': this.form[key], '@input': (event: Event) => this.set(key, (event.target as HTMLTextAreaElement).value) })
                : component(Input, { ...attributes, ...(options.placeholder ? { placeholder: options.placeholder } : {}), '.value': this.form[key], '@input': (event: Event) => this.set(key, (event.target as HTMLInputElement).value) }),
        });
        const page = authorUrl(this.form.slug);
        return html`<div class="max-w-2xl space-y-8">
            <div class="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 class="text-2xl font-bold text-foreground">${__('Public profile')}</h1>
                    <p class="mt-1 text-sm text-muted-foreground">${__('What readers and search engines learn about you as an author. Your name and picture come from your profile.')}</p>
                </div>
                <a href="/dashboard/profile" class="text-sm text-primary hover:underline">← ${__('Profile')}</a>
            </div>
            ${this.error ? notice(this.error, 'error') : null}
            ${component(Card, {}, html`
                ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Author page')}</h2>
                    <p class="text-sm text-muted-foreground">${this.authorPages && page
                        ? html`${__('Your entries are listed at')} <a href=${`${this.origin}${page}`} class="text-primary hover:underline" target="_blank" rel="noopener">${this.origin}${page}</a>`
                        : __('Author pages are off in Settings → SEO; your articles still name you as the author.')}</p>`)}
                ${component(CardBody, {}, html`<form class="space-y-5" @submit=${(event: Event) => this.submit(event)}>
                    ${field('slug', __('Address'), { hint: __('The last part of your author page\'s URL: /author/<address>. Changing it breaks links to the old one.'), placeholder: 'ada-lovelace' })}
                    ${field('jobTitle', __('Job title'), { placeholder: __('Senior editor') })}
                    ${field('bio', __('Bio'), { rows: 4, hint: String(AUTHOR_FIELDS.bio!.description) })}
                    ${field('website', __('Website'), { placeholder: 'https://' })}
                    ${field('profiles', __('Profiles'), { rows: 4, hint: String(AUTHOR_FIELDS.profiles!.description), placeholder: 'https://www.linkedin.com/in/…\nhttps://x.com/…' })}
                    <div>${component(Button, { type: 'submit' }, __('Save profile'))}</div>
                </form>`)}`)}
        </div>`;
    }
}
