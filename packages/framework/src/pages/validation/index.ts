import { html, type TemplateResult } from '@cossackframework/renderer';
import { Cossack, Page, State, Validate, Client, Server, HeadContext, HeadValue } from '@cossackframework/core';

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
        const target = event.target as HTMLInputElement;
        this.setProperty(field, target.value);
        // Validate on input
        this.validateProperty(field);
    }

    @Client()
    handleBlur(field: string, event: Event) {
        // Validate on blur
        this.validateProperty(field);
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
            <div style="max-width: 600px; margin: 0 auto; padding: 2rem;">
                <h1>Validation Demo</h1>
                <p>This page demonstrates the @Validate decorator with various validation rules.</p>

                <form @submit="${(e: Event) => this.handleSubmit(e)}">
                    <!-- Email Field -->
                    <div style="margin-bottom: 1rem;">
                        <label for="email" style="display: block; margin-bottom: 0.5rem;">Email (required, email)</label>
                        <input
                            type="email"
                            id="email"
                            .value="${this.email}"
                            @input="${(e: Event) => this.handleInput('email', e)}"
                            @blur="${(e: Event) => this.handleBlur('email', e)}"
                            style="width: 100%; padding: 0.5rem; border: 1px solid ${this.hasError('email') ? 'red' : '#ccc'}; border-radius: 4px;"
                        />
                        ${this.hasError('email') ? html`<span style="color: red; font-size: 0.875rem;">${this.getError('email')}</span>` : ''}
                    </div>

                    <!-- Password Field -->
                    <div style="margin-bottom: 1rem;">
                        <label for="password" style="display: block; margin-bottom: 0.5rem;">Password (required, minLength: 8)</label>
                        <input
                            type="password"
                            id="password"
                            .value="${this.password}"
                            @input="${(e: Event) => this.handleInput('password', e)}"
                            @blur="${(e: Event) => this.handleBlur('password', e)}"
                            style="width: 100%; padding: 0.5rem; border: 1px solid ${this.hasError('password') ? 'red' : '#ccc'}; border-radius: 4px;"
                        />
                        ${this.hasError('password') ? html`<span style="color: red; font-size: 0.875rem;">${this.getError('password')}</span>` : ''}
                    </div>

                    <!-- Username Field -->
                    <div style="margin-bottom: 1rem;">
                        <label for="username" style="display: block; margin-bottom: 0.5rem;">Username (required, pattern: alphanumeric + underscore)</label>
                        <input
                            type="text"
                            id="username"
                            .value="${this.username}"
                            @input="${(e: Event) => this.handleInput('username', e)}"
                            @blur="${(e: Event) => this.handleBlur('username', e)}"
                            style="width: 100%; padding: 0.5rem; border: 1px solid ${this.hasError('username') ? 'red' : '#ccc'}; border-radius: 4px;"
                        />
                        ${this.hasError('username') ? html`<span style="color: red; font-size: 0.875rem;">${this.getError('username')}</span>` : ''}
                    </div>

                    <!-- Age Field -->
                    <div style="margin-bottom: 1rem;">
                        <label for="age" style="display: block; margin-bottom: 0.5rem;">Age (required, min: 18, max: 120)</label>
                        <input
                            type="number"
                            id="age"
                            .value="${this.age}"
                            @input="${(e: Event) => this.handleInput('age', e)}"
                            @blur="${(e: Event) => this.handleBlur('age', e)}"
                            style="width: 100%; padding: 0.5rem; border: 1px solid ${this.hasError('age') ? 'red' : '#ccc'}; border-radius: 4px;"
                        />
                        ${this.hasError('age') ? html`<span style="color: red; font-size: 0.875rem;">${this.getError('age')}</span>` : ''}
                    </div>

                    <!-- Website Field -->
                    <div style="margin-bottom: 1rem;">
                        <label for="website" style="display: block; margin-bottom: 0.5rem;">Website (url)</label>
                        <input
                            type="url"
                            id="website"
                            .value="${this.website}"
                            @input="${(e: Event) => this.handleInput('website', e)}"
                            @blur="${(e: Event) => this.handleBlur('website', e)}"
                            style="width: 100%; padding: 0.5rem; border: 1px solid ${this.hasError('website') ? 'red' : '#ccc'}; border-radius: 4px;"
                        />
                        ${this.hasError('website') ? html`<span style="color: red; font-size: 0.875rem;">${this.getError('website')}</span>` : ''}
                    </div>

                    <!-- Discount Code Field (customAsync validation) -->
                    <div style="margin-bottom: 1rem;">
                        <label for="discountCode" style="display: block; margin-bottom: 0.5rem;">Discount Code (optional, async server validation)</label>
                        <input
                            type="text"
                            id="discountCode"
                            placeholder="Try: SAVE10, SAVE20, WELCOME, VIP50"
                            .value="${this.discountCode}"
                            @input="${(e: Event) => this.handleInput('discountCode', e)}"
                            @blur="${(e: Event) => this.handleBlur('discountCode', e)}"
                            style="width: 100%; padding: 0.5rem; border: 1px solid ${this.hasError('discountCode') ? 'red' : '#ccc'}; border-radius: 4px;"
                        />
                        ${this.hasError('discountCode') ? html`<span style="color: red; font-size: 0.875rem;">${this.getError('discountCode')}</span>` : ''}
                        <small style="color: #666; font-size: 0.75rem;">Valid codes: SAVE10, SAVE20, WELCOME, VIP50</small>
                    </div>

                    <button type="submit" style="padding: 0.75rem 1.5rem; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        Submit
                    </button>
                </form>

                ${this.submitted ? html`
                    <div style="margin-top: 2rem; padding: 1rem; background: #d4edda; border-radius: 4px;">
                        <h3 style="margin-top: 0; color: #155724;">Form submitted successfully!</h3>
                        <pre style="background: #fff; padding: 1rem; border-radius: 4px; overflow-x: auto;">${JSON.stringify(this.formData, null, 2)}</pre>
                    </div>
                ` : ''}
            </div>
        `;
    }
}
