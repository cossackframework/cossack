import {
    Cossack,
    Page,
    ClientState,
    State,
    Store,
    Client,
    Validate,
    HeadContext,
    HeadValue,
} from '@cossackframework/core';
import { html, component, bind, type TemplateResult } from '@cossackframework/renderer';
import {
    Button,
    Input,
    PasswordInput,
    Label,
    Card,
    CardHeader,
    CardBody,
    CardFooter,
} from '@cossackframework/ui';

@Page({ transport: 'http' })
export default class LoginBlocks extends Cossack {
    @ClientState() tab = 0;

    // ── Form state (two-way bound via `bind(this, 'field')`) ──
    @State() @Validate({ rules: { required: true, email: true, message: 'Enter a valid email' }, config: { trigger: 'blur' } })
    email = '';
    @State() @Validate({ rules: { required: true, minLength: 8, message: 'At least 8 characters' }, config: { trigger: 'blur' } })
    password = '';
    @State() name = '';
    @State() submitted = false;
    // Validation errors store — the framework writes validation errors here.
    @Store() errors: Record<string, string> = {};

    public head(_context: HeadContext): HeadValue {
        return { title: 'Login Blocks' };
    }

    // ── Submit handler — validates then "logs in". Uses preventDefault pattern. ──
    @Client()
    async handleSubmit(e: Event) {
        e.preventDefault();
        const ok = await this.validateAll();
        if (!ok) return;
        this.submitted = true;
    }

    render(): TemplateResult {
        const tabs = ['Simple Card', 'Split Screen', 'Centered + Logo', 'Split Card'];

        return html`
            <div class="min-h-screen bg-background">
                <div class="border-b border-border sticky top-0 bg-background/80 backdrop-blur z-10">
                    <div class="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <a href="/blocks" class="text-sm text-muted-foreground hover:text-foreground">← Blocks</a>
                            <span class="text-muted-foreground">/</span>
                            <h1 class="text-lg font-semibold">Login Forms</h1>
                        </div>
                        <div class="flex gap-1 bg-muted rounded-md p-1">
                            ${tabs.map((t, i) => html`
                                <button type="button"
                                    class=${`px-3 py-1.5 text-sm font-medium rounded-sm cursor-pointer border-none transition-colors ${this.tab === i ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground bg-transparent'}`}
                                    @click=${() => { this.tab = i; }}
                                >${t}</button>
                            `)}
                        </div>
                    </div>
                </div>

                ${this.submitted ? this.successBanner() : null}

                <div class="py-8">
                    ${this.tab === 0 ? this.simpleCard() : null}
                    ${this.tab === 1 ? this.splitScreen() : null}
                    ${this.tab === 2 ? this.centeredLogo() : null}
                    ${this.tab === 3 ? this.splitCard() : null}
                </div>
            </div>
        `;
    }

    private successBanner(): TemplateResult {
        return html`
            <div class="max-w-sm mx-auto mt-4 p-4 rounded-lg bg-success/10 text-success text-sm flex items-center gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                Logged in as <strong>${this.email}</strong>
                <button type="button" class="ml-auto text-success/70 hover:text-success cursor-pointer border-none bg-transparent" @click=${() => { this.submitted = false; }}>×</button>
            </div>
        `;
    }

    /** Shared form fields — two-way bound, validated. */
    private formFields(showName = false): TemplateResult {
        return html`
            ${showName ? html`
                <div>
                    ${component(Label, { for: 'name' }, 'Name')}
                    <input type="text" id="name" class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-muted-foreground"
                        .value=${bind(this, 'name')} />
                </div>
            ` : null}
            <div>
                ${component(Label, { for: 'email' }, 'Email')}
                <input type="email" id="email" placeholder="jane@example.com"
                    class=${`w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-muted-foreground ${this.hasError('email') ? 'border-destructive' : 'border-border'}`}
                    .value=${bind(this, 'email')}
                    @blur=${() => this.validateProperty('email', 'blur')} />
                ${this.hasError('email') ? html`<p class="text-xs text-destructive mt-1">${this.getError('email')}</p>` : null}
            </div>
            <div>
                ${component(Label, { for: 'password' }, 'Password')}
                <input type="password" id="password" placeholder="••••••••"
                    class=${`w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-muted-foreground ${this.hasError('password') ? 'border-destructive' : 'border-border'}`}
                    .value=${bind(this, 'password')}
                    @blur=${() => this.validateProperty('password', 'blur')} />
                ${this.hasError('password') ? html`<p class="text-xs text-destructive mt-1">${this.getError('password')}</p>` : null}
            </div>
            ${component(Button, { type: 'submit', variant: 'default', block: true }, 'Login')}
        `;
    }

    // ─── login-01: Simple centered card ───────────────────────────
    private simpleCard(): TemplateResult {
        return html`
            <div class="flex items-center justify-center min-h-[500px] px-4">
                ${component(Card, { class: 'w-full max-w-sm' }, html`
                    ${component(CardHeader, {}, html`
                        <div class="text-center">
                            <h2 class="text-lg font-semibold text-foreground">Login to your account</h2>
                            <p class="text-sm text-muted-foreground mt-1">Enter your credentials below</p>
                        </div>
                    `)}
                    ${component(CardBody, {}, html`
                        <form class="space-y-4" @submit=${(e: Event) => this.handleSubmit(e)}>
                            ${this.formFields()}
                            <div class="flex items-center gap-3">
                                <div class="flex-1 h-px bg-border"></div>
                                <span class="text-xs text-muted-foreground">OR</span>
                                <div class="flex-1 h-px bg-border"></div>
                            </div>
                            ${component(Button, { variant: 'outline', block: true }, 'Login with Google')}
                        </form>
                    `)}
                    ${component(CardFooter, {}, html`
                        <p class="text-center text-sm text-muted-foreground w-full">Don't have an account? <a href="#" class="text-primary font-medium hover:underline">Sign up</a></p>
                    `)}
                `)}
            </div>
        `;
    }

    // ─── login-02: Split-screen with cover image ──────────────────
    private splitScreen(): TemplateResult {
        return html`
            <div class="grid lg:grid-cols-2 min-h-[500px] rounded-lg overflow-hidden border border-border max-w-5xl mx-auto">
                <div class="flex flex-col justify-center px-8 py-12 lg:px-16">
                    <div class="flex items-center gap-2 mb-8">
                        <span class="w-8 h-8 rounded-md bg-primary text-primary-foreground inline-flex items-center justify-center text-sm font-bold">A</span>
                        <span class="text-sm font-semibold">Acme Inc.</span>
                    </div>
                    <form class="w-full max-w-xs space-y-4" @submit=${(e: Event) => this.handleSubmit(e)}>
                        <div>
                            <h2 class="text-xl font-semibold text-foreground">Welcome back</h2>
                            <p class="text-sm text-muted-foreground mt-1">Sign in to continue</p>
                        </div>
                        ${this.formFields()}
                        <p class="text-center text-sm text-muted-foreground">Don't have an account? <a href="#" class="text-primary font-medium hover:underline">Sign up</a></p>
                    </form>
                </div>
                <div class="hidden lg:block bg-muted relative">
                    <img src="https://images.unsplash.com/photo-1551434678-e076c223a692?q=80&w=1200&auto=format&fit=crop" class="w-full h-full object-cover" alt="" />
                    <div class="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
                    <div class="absolute bottom-8 left-8 right-8 text-white">
                        <p class="text-xl font-semibold">"Cossack transformed how we build apps."</p>
                        <p class="text-sm text-white/80 mt-2">— Jane Doe, CTO at StartupCo</p>
                    </div>
                </div>
            </div>
        `;
    }

    // ─── login-03: Centered card on muted background with logo ────
    private centeredLogo(): TemplateResult {
        return html`
            <div class="flex items-center justify-center min-h-[500px] bg-muted px-4">
                <div class="w-full max-w-sm">
                    <div class="flex items-center justify-center gap-2 mb-6">
                        <span class="w-9 h-9 rounded-lg bg-primary text-primary-foreground inline-flex items-center justify-center font-bold">A</span>
                        <span class="text-lg font-bold text-foreground">Acme Inc.</span>
                    </div>
                    ${component(Card, {}, html`
                        ${component(CardBody, {}, html`
                            <form class="space-y-4" @submit=${(e: Event) => this.handleSubmit(e)}>
                                ${this.formFields()}
                                <div class="flex items-center justify-between">
                                    <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                                        <input type="checkbox" class="rounded border-border" /> Remember me
                                    </label>
                                    <a href="#" class="text-xs text-primary hover:underline">Forgot password?</a>
                                </div>
                            </form>
                        `)}
                    `)}
                    <p class="text-center text-sm text-muted-foreground mt-4">Don't have an account? <a href="#" class="text-primary font-medium hover:underline">Sign up</a></p>
                </div>
            </div>
        `;
    }

    // ─── login-04: Split card with multi-social icons ─────────────
    private splitCard(): TemplateResult {
        return html`
            <div class="flex items-center justify-center min-h-[500px] px-4">
                ${component(Card, { class: 'w-full max-w-3xl overflow-hidden' }, html`
                    ${component(CardBody, { class: 'p-0' }, html`
                        <div class="grid md:grid-cols-2">
                            <div class="p-8 lg:p-10">
                                <h2 class="text-xl font-semibold text-foreground">Welcome back</h2>
                                <p class="text-sm text-muted-foreground mt-1">Sign in to your account</p>
                                <form class="space-y-4 mt-6" @submit=${(e: Event) => this.handleSubmit(e)}>
                                    ${this.formFields()}
                                </form>
                                <div class="flex items-center gap-3 my-4">
                                    <div class="flex-1 h-px bg-border"></div>
                                    <span class="text-xs text-muted-foreground">Or continue with</span>
                                    <div class="flex-1 h-px bg-border"></div>
                                </div>
                                <div class="grid grid-cols-3 gap-2">
                                    ${this.socialIcon('apple')}
                                    ${this.socialIcon('google')}
                                    ${this.socialIcon('github')}
                                </div>
                            </div>
                            <div class="hidden md:flex flex-col items-center justify-center bg-muted p-8 relative">
                                <span class="w-12 h-12 rounded-xl bg-primary text-primary-foreground inline-flex items-center justify-center text-lg font-bold mb-4">A</span>
                                <p class="text-lg font-semibold text-foreground text-center max-w-[200px]">Build amazing apps with Cossack</p>
                                <p class="text-sm text-muted-foreground text-center mt-2 max-w-[200px]">The full-stack TypeScript framework for Cloudflare Workers</p>
                            </div>
                        </div>
                    `)}
                `)}
            </div>
        `;
    }

    private socialIcon(provider: 'apple' | 'google' | 'github'): TemplateResult {
        const icons = {
            apple: '<path d="M17.05 12.04c-.03-2.62 2.14-3.87 2.24-3.93-1.22-1.79-3.13-2.04-3.81-2.07-1.62-.16-3.17.95-3.99.95-.83 0-2.09-.93-3.44-.9-1.77.03-3.41 1.03-4.32 2.62-1.85 3.21-.47 7.95 1.32 10.56.88 1.28 1.93 2.71 3.3 2.66 1.33-.05 1.83-.86 3.43-.86 1.6 0 2.06.86 3.46.83 1.43-.03 2.34-1.3 3.21-2.59 1.01-1.49 1.43-2.94 1.45-3.02-.03-.01-2.78-1.07-2.81-4.25zM14.52 4.3c.73-.88 1.22-2.11 1.09-3.33-1.05.04-2.32.7-3.07 1.58-.68.78-1.27 2.03-1.11 3.23 1.17.09 2.37-.59 3.09-1.48z"/>',
            google: '<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>',
            github: '<path d="M12 .3a12 12 0 00-3.79 23.4c.6.1.82-.26.82-.58v-2.02c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.08 1.84 1.24 1.84 1.24 1.08 1.83 2.81 1.3 3.5.99.1-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 016 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.49 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.58A12 12 0 0012 .3"/>',
        };
        return html`
            <button class="flex items-center justify-center px-3 py-2.5 rounded-md border border-border hover:bg-muted cursor-pointer transition-colors bg-transparent"
                @click=${() => { this.email = 'social@demo.dev'; this.password = 'password123'; }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="${provider === 'google' ? 'none' : 'currentColor'}">${icons[provider]}</svg>
            </button>
        `;
    }
}
