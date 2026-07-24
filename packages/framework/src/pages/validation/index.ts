import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Cossack, Page, State, Validate, Client, Server, HeadContext, HeadValue } from '@cossackframework/core';
import { Alert, Button, Input, Label, Typography } from '@cossackframework/ui';

@Page({
    transport: 'http',
})
export class ValidationDemo extends Cossack {
    @State()
    @Validate({
        rules: { required: true, email: true, message: 'Please enter a valid email address' },
        config: { trigger: 'all', runOn: 'both' }
    })
    email: string = '';

    @State()
    @Validate({
        rules: { required: true, minLength: 8, message: 'Password must be at least 8 characters' },
        config: { trigger: 'all', runOn: 'both' }
    })
    password: string = '';

    @State()
    @Validate({
        rules: { required: true, min: 18, max: 120, message: 'Please enter a valid age (18-120)' },
        config: { trigger: 'all', runOn: 'both' }
    })
    age: string = '';

    @State()
    @Validate({
        rules: { required: true, pattern: /^[a-zA-Z0-9_]+$/, message: 'Username can only contain letters, numbers, and underscores' },
        config: { trigger: 'all', runOn: 'both' }
    })
    username: string = '';

    @State()
    @Validate({
        rules: { url: true, message: 'Please enter a valid URL' },
        config: { trigger: 'all', runOn: 'both' }
    })
    website: string = '';

    // Demo field with customAsync validation
    @State()
    @Validate({
        rules: {
            required: false,
            customAsync: async (value: string, component: any) => {
                // Skip validation if empty (not required)
                if (!value || value.trim() === '') return true;
                // Call server method via proxy - works in both WS and HTTP modes
                // The component parameter gives us access to @Server() methods
                try {
                    return await component.validateDiscountCode(value);
                } catch (e) {
                    console.error('Validation error:', e);
                    return false;
                }
            },
            message: 'Invalid discount code'
        },
        config: { trigger: 'blur', runOn: 'both' }
    })
    discountCode: string = '';

    @State()
    errors: Record<string, string> = {};

    @State()
    submitted: boolean = false;

    @State()
    formData: Record<string, string> = {};

    // Server method to validate discount codes
    @Server()
    async validateDiscountCode(code: string): Promise<boolean> {
        // Simulate server-side validation (e.g., database lookup)
        await new Promise(resolve => setTimeout(resolve, 100));
        const validCodes = ['SAVE10', 'SAVE20', 'WELCOME', 'VIP50', 'FREESHIP'];
        return validCodes.includes(code.toUpperCase());
    }

    public head(context: HeadContext): HeadValue {
        return {
            title: 'Validation Demo'
        };
    }

    @Client()
    handleInput(field: string, event: Event) {
        (this as any)[field] = (event.target as HTMLInputElement).value;
        // Validate on input — fields configured with trigger
        // 'blur' or 'submit' will be skipped here (returns true without running
        // validators).
        this.validateProperty(field, 'input');
    }

    @Client()
    handleBlur(field: string, event: Event) {
        // Validate on blur — fields configured with trigger 'input' or 'submit'
        // will be skipped here.
        this.validateProperty(field, 'blur');
    }

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.submitted = false;

        // Validate all fields
        const isValid = await this.validateAll();

        if (isValid) {
            this.submitted = true;
            this.formData = {
                email: this.email,
                username: this.username,
                age: this.age,
                website: this.website,
                discountCode: this.discountCode || '(none)'
            };
            this.clearErrors();
            this.requestUpdate();
        }
    }

    render(): TemplateResult {
        return html`
            <div class="max-w-150 mx-auto p-8">
                ${component(Typography, { variant: 'h1' }, 'Validation Demo')}
                <p>This page demonstrates the @Validate decorator with various validation rules.</p>

                <form @submit="${(e: Event) => this.handleSubmit(e)}">
                    <!-- Email Field -->
                    <div class="mb-4">
                        ${component(Label, { for: 'email' }, 'Email (required, email)')}
                        ${component(Input, {
                            type: 'email', id: 'email', '.value': this.email,
                            variant: this.hasError('email') ? 'error' : 'default',
                            'aria-invalid': this.hasError('email'),
                            '@input': (e: Event) => this.handleInput('email', e),
                            '@blur': (e: Event) => this.handleBlur('email', e),
                        })}
                        ${this.hasError('email') ? html`<span class="text-red-500 text-sm">${this.getError('email')}</span>` : ''}
                    </div>

                    <!-- Password Field -->
                    <div class="mb-4">
                        ${component(Label, { for: 'password' }, 'Password (required, minLength: 8)')}
                        ${component(Input, {
                            type: 'password', id: 'password', '.value': this.password,
                            variant: this.hasError('password') ? 'error' : 'default',
                            'aria-invalid': this.hasError('password'),
                            '@input': (e: Event) => this.handleInput('password', e),
                            '@blur': (e: Event) => this.handleBlur('password', e),
                        })}
                        ${this.hasError('password') ? html`<span class="text-red-500 text-sm">${this.getError('password')}</span>` : ''}
                    </div>

                    <!-- Username Field -->
                    <div class="mb-4">
                        ${component(Label, { for: 'username' }, 'Username (required, pattern: alphanumeric + underscore)')}
                        ${component(Input, {
                            type: 'text', id: 'username', '.value': this.username,
                            variant: this.hasError('username') ? 'error' : 'default',
                            'aria-invalid': this.hasError('username'),
                            '@input': (e: Event) => this.handleInput('username', e),
                            '@blur': (e: Event) => this.handleBlur('username', e),
                        })}
                        ${this.hasError('username') ? html`<span class="text-red-500 text-sm">${this.getError('username')}</span>` : ''}
                    </div>

                    <!-- Age Field -->
                    <div class="mb-4">
                        ${component(Label, { for: 'age' }, 'Age (required, min: 18, max: 120)')}
                        ${component(Input, {
                            type: 'number', id: 'age', '.value': this.age,
                            variant: this.hasError('age') ? 'error' : 'default',
                            'aria-invalid': this.hasError('age'),
                            '@input': (e: Event) => this.handleInput('age', e),
                            '@blur': (e: Event) => this.handleBlur('age', e),
                        })}
                        ${this.hasError('age') ? html`<span class="text-red-500 text-sm">${this.getError('age')}</span>` : ''}
                    </div>

                    <!-- Website Field -->
                    <div class="mb-4">
                        ${component(Label, { for: 'website' }, 'Website (url)')}
                        ${component(Input, {
                            type: 'url', id: 'website', '.value': this.website,
                            variant: this.hasError('website') ? 'error' : 'default',
                            'aria-invalid': this.hasError('website'),
                            '@input': (e: Event) => this.handleInput('website', e),
                            '@blur': (e: Event) => this.handleBlur('website', e),
                        })}
                        ${this.hasError('website') ? html`<span class="text-red-500 text-sm">${this.getError('website')}</span>` : ''}
                    </div>

                    <!-- Discount Code Field (customAsync validation) -->
                    <div class="mb-4">
                        ${component(Label, { for: 'discountCode' }, 'Discount Code (optional, async server validation)')}
                        ${component(Input, {
                            type: 'text', id: 'discountCode', placeholder: 'Try: SAVE10, SAVE20, WELCOME, VIP50',
                            '.value': this.discountCode,
                            variant: this.hasError('discountCode') ? 'error' : 'default',
                            'aria-invalid': this.hasError('discountCode'),
                            '@input': (e: Event) => this.handleInput('discountCode', e),
                            '@blur': (e: Event) => this.handleBlur('discountCode', e),
                        })}
                        ${this.hasError('discountCode') ? html`<span class="text-red-500 text-sm">${this.getError('discountCode')}</span>` : ''}
                        <small class="text-gray-500 text-xs">Valid codes: SAVE10, SAVE20, WELCOME, VIP50</small>
                    </div>

                    ${component(Button, { type: 'submit' }, 'Submit')}
                </form>

                ${this.submitted ? html`
                    ${component(Alert, { variant: 'success', class: 'mt-8' }, html`
                        <h3 class="font-semibold">Form submitted successfully!</h3>
                        <pre class="bg-white p-4 rounded overflow-x-auto">${JSON.stringify(this.formData, null, 2)}</pre>
                    `)}
                ` : ''}
            </div>
        `;
    }
}
