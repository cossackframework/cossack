import { Client, ClientStore, Cossack, isClientVisibleError, Page, Server, State } from '@cossackframework/core';
import { input, type InputOf } from '@cossackframework/core/input';
import { Alert, Button, Field, Input, PasswordInput, Turnstile } from '@cossackframework/ui';
import { html, component, bind } from '@cossackframework/renderer';
import { networkSite } from '@cossackframework/cms/server';
import { authSessions, logout, type PublicUser } from '#app/auth';
import { registerSite, siteRegistrationOpen } from '#app/cms/site-registration';
import { botCheckKey, passesBotCheck } from '#app/auth-bot-check';
import { BOT_CHECK_FAILED, botCheckToken } from '#app/auth-bot-token';
import { networkFor, siteUrl, type CmsBindings } from '#app/cms/index';

const registerSiteInput = input.object({
    siteName: input.string({ required: true, maxLength: 120 }),
    subdomain: input.string({ required: true, maxLength: 40 }),
    name: input.string({ maxLength: 191 }),
    email: input.string({ maxLength: 191 }),
    password: input.string({ maxLength: 1024 }),
    turnstile: input.string({ maxLength: 4096 }).optional(),
});
type RegisterSiteInput = InputOf<typeof registerSiteInput>;

interface RegisterSiteForm {
    siteName: string;
    subdomain: string;
    name: string;
    email: string;
    password: string;
}

/**
 * Register a site on the network host, while Settings → Network → People can register a site is
 * on: the site's name and address, and the account that runs it. A new account confirms its
 * email first, and the site is made when the link is opened; an existing account gives its
 * password. A person who is signed in gives the site alone, for their own account. The person
 * becomes the site's administrator and is taken there.
 */
@Page({ transport: 'http' })
export default class RegisterSitePage extends Cossack {
    @ClientStore() form: RegisterSiteForm = { siteName: '', subdomain: '', name: '', email: '', password: '' };
    @State() closed = false;
    /** The domain the address ends with, such as `example.com`. */
    @State() suffix = '';
    @State() sent = false;
    @State() error = '';
    /** The Turnstile site key while the bot check is on. */
    @State() botKey: string | null = null;
    /** The signed-in person's email: the site is theirs, and the form asks for no account. */
    @State() signedInAs: string | null = null;

    async init() {
        this.closed = !(await siteRegistrationOpen());
        this.botKey = botCheckKey();
        this.signedInAs = (this.c.get('user') as PublicUser | undefined)?.email ?? null;
        const network = networkFor(this.c.env as CmsBindings);
        if (!this.closed) this.suffix = (await network.settings()).subdomainSuffix || network.subdomainSuffix || 'localhost';
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        this.error = '';
        await this.register({ ...this.form, turnstile: botCheckToken(event.target) });
    }

    @Server({ input: registerSiteInput })
    async register(submitted: RegisterSiteInput) {
        const values = await registerSiteInput.parse(submitted);
        this.error = '';
        if (!(await passesBotCheck(values.turnstile, 'register'))) { this.error = BOT_CHECK_FAILED; return; }
        // The session names the account, never the form.
        const user = (this.c.get('user') as PublicUser | undefined) ?? null;
        if (!user && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim()) || values.password.length < 8)) {
            this.error = 'Enter your email and a password of at least 8 characters.';
            return;
        }
        try {
            // The domain is the network's, whatever the browser sent.
            const network = networkFor(this.c.env as CmsBindings);
            const suffix = (await network.settings()).subdomainSuffix || network.subdomainSuffix || 'localhost';
            const site = { name: values.siteName, host: `${values.subdomain.trim().toLowerCase()}.${suffix}` };
            const result = await registerSite(user ? { site } : { site, name: values.name, email: values.email.trim(), password: values.password }, user?.id ?? null);
            if (result.signIn) {
                const { headers } = await authSessions.create(result.user, this.c);
                headers.forEach((value, key) => this.c.header(key, value));
            }
            // Signed in here, the new site's link to the network signs its administrator in there.
            const record = await network.sites.get(result.site);
            const target = record ? siteUrl(this.c.env as CmsBindings, networkSite(record)) : undefined;
            this.redirect(target ? `${target.replace(/\/+$/, '')}/auth/tenant/start?next=${encodeURIComponent('/dashboard')}` : '/dashboard');
        } catch (error) {
            this.error = isClientVisibleError(error) ? error.message : 'Could not register the site. Try again.';
        }
    }

    /** Sign out, to register the site with another account. */
    @Server()
    async signOut() {
        this.error = '';
        try {
            const { headers } = await logout(this.c);
            headers.forEach((value, key) => this.c.header(key, value));
            this.redirect('/auth/register-site');
        } catch {
            this.error = 'Could not sign out. Try again.';
        }
    }

    render() {
        if (this.closed) return html`
            <h3 class="mb-3 text-xl font-semibold text-foreground">${__('Register a site')}</h3>
            ${component(Alert, {}, __('Site registration is closed on this network.'))}
            <p class="mt-6 text-center text-sm text-muted-foreground"><a href="/auth/login" class="text-primary font-medium hover:underline">${__('Sign in')}</a></p>`;
        if (this.sent) return html`
            <h3 class="mb-3 text-xl font-semibold text-foreground">${__('Check your email')}</h3>
            ${component(Alert, {}, __('We sent you a link to confirm your email address. Open it to create your site; it works for two days.'))}
            <p class="mt-6 text-center text-sm text-muted-foreground"><a href="/auth/login" class="text-primary font-medium hover:underline">${__('Back to sign in')}</a></p>`;
        return html`
            <h3 class="mb-6 text-xl font-semibold text-foreground">${__('Register a site')}</h3>
            <form @submit=${(event: Event) => this.submit(event)} class="space-y-4" data-register-site>
                ${component(Field, { label: __('Site name'), for: 'site-name',
                    control: attributes => component(Input, { ...attributes, type: 'text', required: true, maxlength: 120, '.value': bind(this.form, 'siteName') }) })}
                ${component(Field, { label: __('Site address'), for: 'site-subdomain', hint: `${__('Lowercase letters, digits and hyphens.')} ${__('Your site will be at')} ${this.form.subdomain || 'name'}.${this.suffix}`,
                    control: attributes => html`<div class="flex items-center gap-2">
                        ${component(Input, { ...attributes, type: 'text', required: true, maxlength: 40, pattern: '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?', autocapitalize: 'off', spellcheck: 'false', '.value': bind(this.form, 'subdomain') })}
                        <span class="shrink-0 text-sm text-muted-foreground">.${this.suffix}</span>
                    </div>` })}
                ${this.signedInAs ? html`<p class="text-sm text-muted-foreground" data-signed-in-as>${__('Signed in as')} <span class="font-medium text-foreground">${this.signedInAs}</span>. ${__('The site will be yours.')}</p>` : html`
                ${component(Field, { label: __('Your name'), for: 'name',
                    control: attributes => component(Input, { ...attributes, type: 'text', autocomplete: 'name', '.value': bind(this.form, 'name') }) })}
                ${component(Field, { label: __('Email'), for: 'email',
                    control: attributes => component(Input, { ...attributes, type: 'email', autocomplete: 'username', spellcheck: 'false', required: true, '.value': bind(this.form, 'email') }) })}
                ${component(Field, { label: __('Password'), for: 'password', hint: __('At least 8 characters. Have an account? Enter its email and password.'),
                    control: attributes => component(PasswordInput, { ...attributes, autocomplete: 'new-password', required: true, minlength: 8, value: this.form.password, onValueChange: (value: string) => { this.form.password = value; } }) })}`}
                ${this.botKey ? component(Turnstile, { id: 'register-site-verify', siteKey: this.botKey, action: 'register', label: __('Bot protection') }) : null}
                ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
                ${component(Button, { type: 'submit', block: true }, __('Create site'))}
            </form>
            ${this.signedInAs ? html`<p class="mt-6 text-center text-sm text-muted-foreground">
                ${__('Another account?')}
                <button type="button" class="text-primary font-medium hover:underline" @click=${() => this.signOut()} data-sign-out>${__('Sign out')}</button>
            </p>` : html`<p class="mt-6 text-center text-sm text-muted-foreground">
                ${__('Already have a site?')}
                <a href="/auth/login" class="text-primary font-medium hover:underline">${__('Sign in')}</a>
            </p>`}`;
    }
}
