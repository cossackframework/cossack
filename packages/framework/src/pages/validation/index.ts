import { html, bind, type TemplateResult } from '@cossackframework/renderer';
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
        // Value sync is handled by `bind()` on each input; this handler only
        // runs validation. Validate on input — fields configured with trigger
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
            <div class="max-w-[600px] mx-auto p-8">
                <h1>Validation Demo</h1>
                <p>This page demonstrates the @Validate decorator with various validation rules.</p>

                <form @submit="${(e: Event) => this.handleSubmit(e)}">
                    <!-- Email Field -->
                    <div class="mb-4">
                        <label for="email" class="block mb-2">Email (required, email)</label>
                        <input
                            type="email"
                            id="email"
                            .value="${bind(this, 'email')}"
                            @input="${(e: Event) => this.handleInput('email', e)}"
                            @blur="${(e: Event) => this.handleBlur('email', e)}"
                            class="w-full p-2 border rounded ${this.hasError('email') ? 'border-red-500' : 'border-gray-300'}"
                        />
                        ${this.hasError('email') ? html`<span class="text-red-500 text-sm">${this.getError('email')}</span>` : ''}
                    </div>

                    <!-- Password Field -->
                    <div class="mb-4">
                        <label for="password" class="block mb-2">Password (required, minLength: 8)</label>
                        <input
                            type="password"
                            id="password"
                            .value="${bind(this, 'password')}"
                            @input="${(e: Event) => this.handleInput('password', e)}"
                            @blur="${(e: Event) => this.handleBlur('password', e)}"
                            class="w-full p-2 border rounded ${this.hasError('password') ? 'border-red-500' : 'border-gray-300'}"
                        />
                        ${this.hasError('password') ? html`<span class="text-red-500 text-sm">${this.getError('password')}</span>` : ''}
                    </div>

                    <!-- Username Field -->
                    <div class="mb-4">
                        <label for="username" class="block mb-2">Username (required, pattern: alphanumeric + underscore)</label>
                        <input
                            type="text"
                            id="username"
                            .value="${bind(this, 'username')}"
                            @input="${(e: Event) => this.handleInput('username', e)}"
                            @blur="${(e: Event) => this.handleBlur('username', e)}"
                            class="w-full p-2 border rounded ${this.hasError('username') ? 'border-red-500' : 'border-gray-300'}"
                        />
                        ${this.hasError('username') ? html`<span class="text-red-500 text-sm">${this.getError('username')}</span>` : ''}
                    </div>

                    <!-- Age Field -->
                    <div class="mb-4">
                        <label for="age" class="block mb-2">Age (required, min: 18, max: 120)</label>
                        <input
                            type="number"
                            id="age"
                            .value="${bind(this, 'age')}"
                            @input="${(e: Event) => this.handleInput('age', e)}"
                            @blur="${(e: Event) => this.handleBlur('age', e)}"
                            class="w-full p-2 border rounded ${this.hasError('age') ? 'border-red-500' : 'border-gray-300'}"
                        />
                        ${this.hasError('age') ? html`<span class="text-red-500 text-sm">${this.getError('age')}</span>` : ''}
                    </div>

                    <!-- Website Field -->
                    <div class="mb-4">
                        <label for="website" class="block mb-2">Website (url)</label>
                        <input
                            type="url"
                            id="website"
                            .value="${bind(this, 'website')}"
                            @input="${(e: Event) => this.handleInput('website', e)}"
                            @blur="${(e: Event) => this.handleBlur('website', e)}"
                            class="w-full p-2 border rounded ${this.hasError('website') ? 'border-red-500' : 'border-gray-300'}"
                        />
                        ${this.hasError('website') ? html`<span class="text-red-500 text-sm">${this.getError('website')}</span>` : ''}
                    </div>

                    <!-- Discount Code Field (customAsync validation) -->
                    <div class="mb-4">
                        <label for="discountCode" class="block mb-2">Discount Code (optional, async server validation)</label>
                        <input
                            type="text"
                            id="discountCode"
                            placeholder="Try: SAVE10, SAVE20, WELCOME, VIP50"
                            .value="${bind(this, 'discountCode')}"
                            @input="${(e: Event) => this.handleInput('discountCode', e)}"
                            @blur="${(e: Event) => this.handleBlur('discountCode', e)}"
                            class="w-full p-2 border rounded ${this.hasError('discountCode') ? 'border-red-500' : 'border-gray-300'}"
                        />
                        ${this.hasError('discountCode') ? html`<span class="text-red-500 text-sm">${this.getError('discountCode')}</span>` : ''}
                        <small class="text-gray-500 text-xs">Valid codes: SAVE10, SAVE20, WELCOME, VIP50</small>
                    </div>

                    <button type="submit" class="py-3 px-6 bg-blue-500 text-white border-none rounded cursor-pointer">
                        Submit
                    </button>
                </form>

                ${this.submitted ? html`
                    <div class="mt-8 p-4 bg-green-100 rounded">
                        <h3 class="mt-0 text-green-800">Form submitted successfully!</h3>
                        <pre class="bg-white p-4 rounded overflow-x-auto">${JSON.stringify(this.formData, null, 2)}</pre>
                    </div>
                ` : ''}
            </div>
        `;
    }
}
