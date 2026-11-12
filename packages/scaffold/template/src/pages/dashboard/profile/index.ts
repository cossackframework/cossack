import { Cossack, Page, State, ClientState, Store, Validate, Client, Server, storeRules, getLocale, getSupportedLocales, setLocale } from '@cossackframework/core';
import { input } from '@cossackframework/core/input';
import { Card, CardBody, CardHeader, Field, Input, Button, Avatar, Form, NativeSelect } from '@cossackframework/ui';
import { notice, pageHeader } from '@cossackframework/ui/blocks';
import { html, component, bind } from '@cossackframework/renderer';
import { avatarUploads, deleteOwnAccount, updateUserProfile, uploadAvatar } from '../../../auth';
import { avatarField } from '../../../dashboard/avatar-field';

/** A language's name in itself, such as Français or Tiếng Việt. */
function languageLabel(code: string): string {
    try { return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code; } catch { return code; }
}

interface ProfileForm {
    name: string;
    avatar: string;
}

@Page({ transport: 'http' })
export default class ProfilePage extends Cossack {
    @Store()
    @Validate({
        rules: storeRules<ProfileForm>({
            name: { required: true, message: 'Name is required' },
        }),
        config: { trigger: 'all', runOn: 'both' }
    })
    form: ProfileForm = { name: '', avatar: '' };

    @State() saved = false;
    @State() error = '';
    /** What the last action did, shown under the heading. */
    @State() message = '';
    /** Email shown in the profile card (read-only; seeded server-side). */
    @State() userEmail = '';
    /** Whether the auth store accepts picture uploads; otherwise the avatar is a URL. */
    @State() avatarUploads = false;
    @ClientState() uploading = false;
    @ClientState() avatarError = '';
    /** The chosen picture while it uploads; browser-only, so server state never echoes it back. */
    @ClientState() avatarPreview = '';
    /** Languages the interface has catalogs for, from the application and language packs. */
    @State() languages: { code: string; label: string }[] = [];
    @State() language = '';

    async init() {
        // Seed the form server-side (serializes via @Store) so it's populated
        // at SSR — not empty until onMount runs client-side.
        const user = this.user;
        if (user) {
            this.form.name = user.name;
            this.form.avatar = user.avatar ?? '';
            this.userEmail = user.email;
        }
        this.avatarUploads = avatarUploads;
        this.languages = getSupportedLocales().map(code => ({ code, label: languageLabel(code) }));
        this.language = getLocale();
    }

    /** Keep the dashboard's language in this browser (the `cossack_locale` cookie), then draw it again. */
    @Client()
    async chooseLanguage(event: Event) {
        this.error = '';
        try {
            await setLocale((event.target as HTMLSelectElement).value);
            window.location.reload();
        } catch {
            this.error = __('That language could not be loaded.');
        }
    }

    /** Upload a picture: it shows at once and is saved when the upload finishes. */
    @Client()
    async chooseAvatar(file: File) {
        this.avatarError = '';
        this.message = '';
        this.uploading = true;
        const preview = URL.createObjectURL(file);
        this.avatarPreview = preview;
        try {
            await this.storeAvatar(file);
            this.message = __('Picture updated.');
        } catch (e: any) {
            this.avatarError = e?.message || __('The picture could not be uploaded.');
        } finally {
            this.uploading = false;
            this.avatarPreview = '';
            URL.revokeObjectURL(preview);
        }
    }

    /** The stored picture's URL comes back as state. */
    @Server({ input: input.args(input.file()) })
    async storeAvatar(file: File) {
        this.form.avatar = await uploadAvatar(this.user!.id, file);
    }

    @Client()
    async removeAvatar() {
        this.form.avatar = '';
        this.message = '';
        await this.clearAvatar();
        this.message = __('Picture removed.');
    }

    @Server()
    async clearAvatar() {
        await updateUserProfile(this.user!.id, { avatar: null });
        this.form.avatar = '';
    }

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.error = '';
        this.message = '';
        this.saved = false;
        const ok = await this.validateAll();
        if (!ok) return;
        try {
            await this.save(this.form.name, this.form.avatar);
            this.saved = true;
            this.message = __('Profile updated.');
        } catch (e: any) {
            this.error = e?.message || 'Could not save profile';
        }
    }

    @Server()
    async save(name: string, avatar: string) {
        await updateUserProfile(this.user!.id, { name, avatar: avatar || null });
    }

    @ClientState() deletePassword = '';
    @State() deleteError = '';

    @Client()
    async confirmDelete(event: Event) {
        event.preventDefault();
        if (!this.deletePassword || !window.confirm(__('Delete your account for good? This cannot be undone.'))) return;
        await this.deleteAccount(this.deletePassword);
    }

    /** Ends every session and deletes the account; the browser lands on the home page signed out. */
    @Server()
    async deleteAccount(password: string) {
        this.deleteError = '';
        try {
            const { headers } = await deleteOwnAccount(this.c, this.user!.id, password);
            headers.forEach((value, key) => this.c.header(key, value));
            this.redirect('/');
        } catch (error) {
            this.deleteError = (error as Error).message || __('The account could not be deleted.');
        }
    }

    render() {
        return html`
            <div class="max-w-2xl space-y-6">
                ${pageHeader(__('Profile'), { description: __('Update your display name and avatar.'),
                    actions: html`<a href="/dashboard/profile/security" class="text-sm text-primary hover:underline">${__('Security and application passwords')} →</a>` })}
                ${this.message && !this.error ? notice(this.message, 'success') : null}
                ${this.error ? notice(this.error, 'error') : null}

                ${component(Card, {}, component(CardBody, {}, html`
                    <div class="flex items-center gap-4">
                        ${component(Avatar, { src: this.form.avatar || undefined, alt: this.form.name, size: 56 })}
                        <div>
                            <div class="text-sm text-muted-foreground">${__('Email')}</div>
                            <div class="text-foreground font-medium">${this.userEmail}</div>
                        </div>
                    </div>
                `))}

                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Edit profile')}</h2>`)}
                    ${component(CardBody, {}, html`
                        ${component(Form, {
                            submit: (e: Event) => this.handleSubmit(e),
                        }, html`
                            <div class="flex flex-col space-y-4">
                            ${component(Field, { label: __('Name'), for: 'name', error: this.getError('form.name'),
                                control: attributes => component(Input, { ...attributes, type: 'text', '.value': bind(this.form, 'name') }) })}
                            ${avatarField({ id: 'avatar', value: this.avatarPreview || this.form.avatar, name: this.form.name, uploads: this.avatarUploads, uploading: this.uploading, error: this.avatarError,
                                onFile: file => this.chooseAvatar(file), onUrl: url => { this.form.avatar = url; }, onRemove: () => this.removeAvatar() })}
                            <div>${component(Button, { type: 'submit' }, __('Save changes'))}</div>
                            </div>
                        `)}
                    `)}
                `)}

                ${this.languages.length > 1 ? component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Dashboard language')}</h2>`)}
                    ${component(CardBody, {}, component(Field, { label: __('Language'), for: 'dashboard-language', hint: __('Kept in this browser.'),
                        control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => this.chooseLanguage(event) }, html`
                            ${this.languages.map(language => html`<option value=${language.code} ?selected=${language.code === this.language}>${language.label}</option>`)}`) }))}
                `) : null}
                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-destructive">${__('Delete your account')}</h2>
                        <p class="text-sm text-muted-foreground">${__('Your account and its sessions go for good. What you published stays, without you as its author.')}</p>`)}
                    ${component(CardBody, {}, html`<form class="flex flex-wrap items-end gap-3" @submit=${(event: Event) => this.confirmDelete(event)}>
                        ${component(Field, { label: __('Your password'), for: 'delete-password', control: attributes => component(Input, { ...attributes, type: 'password', autocomplete: 'current-password', required: true,
                            '.value': this.deletePassword, '@input': (event: Event) => { this.deletePassword = (event.target as HTMLInputElement).value; } }) })}
                        ${component(Button, { type: 'submit', variant: 'destructive' }, __('Delete my account'))}
                        ${this.deleteError ? html`<p role="alert" class="w-full text-sm text-destructive">${this.deleteError}</p>` : null}
                    </form>`)}
                `)}
            </div>
        `;
    }
}
