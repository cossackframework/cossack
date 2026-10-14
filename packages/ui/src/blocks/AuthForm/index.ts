import { html, component, repeat, ifDefined, PreventDefaultResult, preventDefault } from '@cossackframework/renderer';
import { Cossack, Component, ClientState, Client } from '@cossackframework/core';
import type { GlobalAttributes, FormAttributes, ControlEvent } from '../../native-attributes.js';
import { ControlledValue } from '../../native-attributes.js';
import { Button } from '../../components/Button.js';
import { Input } from '../../components/Input.js';
import { PasswordInput } from '../../components/PasswordInput.js';
import { Label } from '../../components/Label.js';

export type AuthFormMode = 'login' | 'signup';
export type AuthFormData = { mode: 'login'; email: string; password: string }
    | { mode: 'signup'; email: string; password: string; name: string };
export interface AuthFormResult {
    /** Safe, localized text intended for display; never return a raw exception. */
    error?: string;
    fieldErrors?: Partial<Record<'email' | 'password' | 'name', string>>;
}
export interface AuthFormContext { readonly signal: AbortSignal; }
export interface AuthFormProvider { readonly id: string; readonly label: string; }
export interface AuthFormLabels {
    loginTitle: string; signupTitle: string; email: string; password: string; name: string;
    loginSubmit: string; signupSubmit: string; pending: string; failure: string;
    loginSwitch: string; signupSwitch: string; showPassword: string; hidePassword: string;
    javascriptRequired: string; passwordTooShort: string;
}
export type AuthFormNativeProps = Omit<FormAttributes, 'id' | 'action' | 'method' | 'enctype' | 'target' | 'novalidate' | '?novalidate' | 'aria-label' | 'aria-labelledby' | 'aria-busy'>;
type SharedProps = Omit<GlobalAttributes<HTMLDivElement>, 'id'> & {
    /** Stable, page-unique identity used by the form and its labels. */
    id: string;
    onSubmit: (data: AuthFormData, context: AuthFormContext) => void | AuthFormResult | Promise<void | AuthFormResult>;
    /** Explicit provider actions; no provider is enabled by default. */
    providers?: readonly AuthFormProvider[];
    onSocial?: (provider: string, context: AuthFormContext) => void | AuthFormResult | Promise<void | AuthFormResult>;
    disabled?: boolean;
    /** Native signup constraint only. Login accepts existing shorter passwords. Default 8. */
    signupPasswordMinLength?: number;
    labels?: Partial<AuthFormLabels>;
    /** Attributes/events target the native form, not the root div. @submit can veto submission. */
    formProps?: AuthFormNativeProps;
};
export type AuthFormProps = SharedProps & (
    { mode: AuthFormMode; defaultMode?: never; onModeChange: (mode: AuthFormMode) => unknown }
    | { mode?: never; defaultMode?: AuthFormMode; onModeChange?: (mode: AuthFormMode) => unknown }
);
const LABELS: AuthFormLabels = {
    loginTitle: 'Welcome back', signupTitle: 'Create your account', email: 'Email', password: 'Password', name: 'Name',
    loginSubmit: 'Sign in', signupSubmit: 'Create account', pending: 'Please wait…', failure: 'Unable to complete this request. Please try again.',
    loginSwitch: 'Sign in instead', signupSwitch: 'Create an account instead', showPassword: 'Show password', hidePassword: 'Hide password',
    javascriptRequired: 'Enable JavaScript to use this form.', passwordTooShort: 'Password is too short.',
};

/** Credential and provider UI only. Applications own authentication and authorization. */
@Component()
export class AuthForm extends Cossack {
    declare props: AuthFormProps;
    @ClientState() private localMode: AuthFormMode | undefined;
    @ClientState() private hydrated = false;
    @ClientState() private pending = false;
    @ClientState() private feedback: AuthFormResult | undefined;
    private initialMode?: AuthFormMode;
    private renderedMode?: AuthFormMode;
    private controlled = new ControlledValue<AuthFormMode>();
    private connected = false;
    private revision = 0;
    private active?: AbortController;

    private currentMode(): AuthFormMode {
        this.initialMode ??= this.props.defaultMode ?? 'login';
        return this.props.mode ?? this.localMode ?? this.initialMode;
    }
    private cancel() {
        this.revision++;
        this.active?.abort();
        this.active = undefined;
    }
    onMount() {
        this.connected = true;
        this.hydrated = true;
    }
    onCleanup() {
        this.connected = false; this.cancel();
    }
    render() {
        const { id, mode: _mode, defaultMode: _defaultMode, onModeChange: _change, onSubmit,
            providers = [], onSocial, disabled = false, signupPasswordMinLength = 8,
            labels: suppliedLabels, formProps, ...root } = this.props;
        if (typeof id !== 'string' || !id.trim() || /\s/.test(id)) throw new Error('AuthForm requires a stable, nonempty id without whitespace.');
        if (typeof onSubmit !== 'function') throw new Error('AuthForm requires onSubmit.');
        const mode = this.currentMode();
        if (!['login', 'signup'].includes(mode) || (_defaultMode !== undefined && !['login', 'signup'].includes(_defaultMode))) throw new Error('AuthForm mode must be login or signup.');
        if (_mode !== undefined && (_defaultMode !== undefined || typeof _change !== 'function')) throw new Error('Controlled AuthForm requires onModeChange and no defaultMode.');
        if (!Number.isSafeInteger(signupPasswordMinLength) || signupPasswordMinLength < 1) throw new Error('AuthForm signupPasswordMinLength must be a positive integer.');
        const ids = new Set<string>();
        for (const provider of providers) {
            if (!provider || typeof provider.id !== 'string' || !provider.id.trim() || ids.has(provider.id) || typeof provider.label !== 'string' || !provider.label.trim()) throw new Error('AuthForm providers require unique nonempty IDs and labels.');
            ids.add(provider.id);
        }
        if (providers.length && typeof onSocial !== 'function') throw new Error('AuthForm providers require onSocial.');
        const labels = { ...LABELS, ...suppliedLabels };
        for (const value of Object.values(labels)) if (typeof value !== 'string' || !value.trim()) throw new Error('AuthForm labels must be nonempty text.');
        if (this.children != null && this.children !== false && this.children !== '') throw new Error('AuthForm does not accept positional children.');
        if (this.renderedMode !== undefined && this.renderedMode !== mode) {
            this.cancel(); this.pending = false; this.feedback = undefined;
        }
        this.renderedMode = mode;
        const signup = mode === 'signup', busy = this.pending, unavailable = disabled || busy;
        const { '@submit': suppliedSubmit, ...nativeForm } = formProps ?? {};
        const submit: EventListener = event => {
            let vetoed = event.defaultPrevented;
            try {
                if (typeof suppliedSubmit === 'function') suppliedSubmit(event as ControlEvent<HTMLFormElement, SubmitEvent>);
                else if (suppliedSubmit instanceof PreventDefaultResult) suppliedSubmit.handler.call(event.currentTarget, event);
                vetoed = event.defaultPrevented;
            } finally {
                // Even a throwing native listener must not submit credentials by navigation.
                event.preventDefault();
            }
            if (!vetoed) void this.submit(event as SubmitEvent);
        };
        const fieldError = (field: 'name' | 'email' | 'password') => this.feedback?.fieldErrors?.[field];
        const help = (field: 'name' | 'email' | 'password') => fieldError(field)
            ? html`<p id=${`${id}-${field}-error`} class="text-sm text-destructive">${fieldError(field)}</p>` : null;
        return html`<div id=${id} class="cs-auth-form w-full max-w-sm mx-auto" ...=${root}>
            <h2 id=${`${id}-title`} class="mb-6 text-center text-2xl font-bold text-foreground">${signup ? labels.signupTitle : labels.loginTitle}</h2>
            ${providers.length ? html`<div class="mb-4 flex flex-col gap-2">${repeat(providers, provider => provider.id, provider => component(Button, {
                type: 'button', variant: 'outline', disabled: unavailable || !this.hydrated,
                'data-provider': provider.id, '@click': (event) => this.social(provider.id, event.currentTarget),
            }, provider.label))}</div>` : null}
            <form ...=${nativeForm} id=${`${id}-form`} method="post" aria-labelledby=${`${id}-title`} aria-busy=${busy}
                @submit=${suppliedSubmit instanceof PreventDefaultResult ? preventDefault(submit, { novalidate: false }) : submit}>
                <fieldset ?disabled=${unavailable} class="space-y-4 border-0 p-0 m-0 min-w-0">
                    ${signup ? html`<div>${component(Label, { for: `${id}-name` }, labels.name)}
                        ${component(Input, { id: `${id}-name`, name: 'name', type: 'text', autocomplete: 'name',
                            'aria-invalid': !!fieldError('name'), 'aria-describedby': ifDefined(fieldError('name') ? `${id}-name-error` : undefined),
                            '@input': () => this.clearField('name') })}${help('name')}</div>` : null}
                    <div>${component(Label, { for: `${id}-email` }, labels.email)}
                        ${component(Input, { id: `${id}-email`, name: 'email', type: 'email', autocomplete: 'username', required: true,
                            'aria-invalid': !!fieldError('email'), 'aria-describedby': ifDefined(fieldError('email') ? `${id}-email-error` : undefined),
                            '@input': () => this.clearField('email') })}${help('email')}</div>
                    <div>${component(Label, { for: `${id}-password` }, labels.password)}
                        ${component(PasswordInput, { id: `${id}-password`, name: 'password', required: true,
                            autocomplete: signup ? 'new-password' : 'current-password', minlength: ifDefined(signup ? signupPasswordMinLength : undefined),
                            showLabel: labels.showPassword, hideLabel: labels.hidePassword,
                            'aria-invalid': !!fieldError('password'), 'aria-describedby': ifDefined(fieldError('password') ? `${id}-password-error` : undefined),
                            '@input': () => this.clearField('password') })}${help('password')}</div>
                    ${component(Button, { type: 'submit', block: true, disabled: unavailable || !this.hydrated }, signup ? labels.signupSubmit : labels.loginSubmit)}
                </fieldset>
                <div role="alert" class="mt-2 text-sm text-destructive">${this.feedback?.error ?? ''}</div>
                <div role="status" class="mt-2 text-sm text-muted-foreground">${busy ? labels.pending : ''}</div>
                ${!this.hydrated ? html`<p class="text-sm text-muted-foreground">${labels.javascriptRequired}</p>` : null}
            </form>
            ${component(Button, { type: 'button', variant: 'link', disabled: unavailable || !this.hydrated,
                '@click': () => this.changeMode() }, signup ? labels.loginSwitch : labels.signupSwitch)}
        </div>`;
    }
    @Client()
    private clearField(field: 'name' | 'email' | 'password') {
        if (!this.feedback) return;
        const fields = { ...this.feedback.fieldErrors }; delete fields[field];
        this.feedback = { fieldErrors: fields };
    }
    @Client()
    private changeMode() {
        if (!this.connected || this.pending || this.props.disabled) return;
        const next = this.controlled.base(this.props, this.currentMode()) === 'login' ? 'signup' : 'login';
        if (this.props.mode === undefined) this.localMode = next;
        this.props.onModeChange?.(this.controlled.emit(this.props, next));
    }
    @Client()
    private async submit(event: SubmitEvent) {
        const form = event.currentTarget as HTMLFormElement;
        if (!this.connected || this.pending || this.props.disabled || !form.isConnected || (form.elements.namedItem('email') as HTMLInputElement)?.matches(':disabled') || !form.reportValidity()) return;
        // Read the browser, not reactive state: includes autofill and pre-hydration edits.
        const values = new FormData(form), mode = this.currentMode();
        const email = String(values.get('email') ?? ''), password = String(values.get('password') ?? '');
        if (mode === 'signup' && password.length < (this.props.signupPasswordMinLength ?? 8)) {
            // A newly applied native minlength does not necessarily invalidate an
            // existing browser value. Check the snapshot before invoking the app.
            this.feedback = { fieldErrors: { password: this.props.labels?.passwordTooShort ?? LABELS.passwordTooShort } };
            await this.requestUpdate();
            if (this.connected && form.isConnected) (form.elements.namedItem('password') as HTMLInputElement).focus();
            return;
        }
        const data: AuthFormData = mode === 'signup' ? { mode, email, password, name: String(values.get('name') ?? '') } : { mode, email, password };
        await this.run(context => this.props.onSubmit(data, context), form);
    }
    @Client()
    private async social(provider: string, button: HTMLButtonElement) {
        if (!this.connected || this.pending || this.props.disabled || button.matches(':disabled') || !this.props.providers?.some(item => item.id === provider)) return;
        const callback = this.props.onSocial;
        if (callback) await this.run(context => callback(provider, context), button.closest('.cs-auth-form')!.querySelector('form')!);
    }
    @Client()
    private async run(callback: (context: AuthFormContext) => void | AuthFormResult | Promise<void | AuthFormResult>, form: HTMLFormElement) {
        const controller = new AbortController(), revision = ++this.revision;
        this.active = controller; this.pending = true; this.feedback = undefined;
        let result: AuthFormResult | undefined;
        try {
            const response = await callback({ signal: controller.signal });
            if (response !== undefined) {
                if (!response || typeof response !== 'object' || (response.error !== undefined && typeof response.error !== 'string')) throw new Error('Invalid AuthForm result.');
                const fieldErrors: AuthFormResult['fieldErrors'] = {};
                for (const field of ['name', 'email', 'password'] as const) {
                    const error = response.fieldErrors?.[field];
                    if (error !== undefined && typeof error !== 'string') throw new Error('Invalid AuthForm field error.');
                    if (error) fieldErrors[field] = error;
                }
                result = { error: response.error, fieldErrors };
            }
        } catch {
            result = { error: this.props.labels?.failure ?? LABELS.failure };
        }
        if (!this.connected || revision !== this.revision || controller.signal.aborted || !form.isConnected) return;
        const focused = form.ownerDocument.activeElement;
        const mayFocus = focused === form.ownerDocument.body || form.contains(focused);
        this.active = undefined; this.feedback = result; this.pending = false;
        await this.requestUpdate();
        if (!this.connected || revision !== this.revision || !form.isConnected || !mayFocus || (form.ownerDocument.activeElement !== focused && form.ownerDocument.activeElement !== form.ownerDocument.body)) return;
        for (const field of ['name', 'email', 'password'] as const) {
            if (!result?.fieldErrors?.[field]) continue;
            const input = form.elements.namedItem(field);
            if (input instanceof HTMLInputElement && !input.matches(':disabled')) { input.focus(); break; }
        }
    }
}
