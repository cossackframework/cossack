import { html, type TemplateResult } from '@cossackframework/renderer';
import {
    Cossack,
    Page,
    State,
    Store,
    Validate,
    Client,
    Server,
    storeRules,
    HeadContext,
    HeadValue,
} from '@cossackframework/core';

interface SubmitFormState {
    email: string;
    password: string;
    age: string;
    username: string;
    website: string;
    discountCode: string;
    // Nested object field — exercises deep (multi-level) reactivity.
    address: {
        zip: string;
        country: string;
    };
    // Array field — exercises array mutation reactivity (push/splice/etc.).
    tags: string[];
}

@Page({
    transport: 'http',
})
export class StoreValidationDemo extends Cossack {
    @Store()
    @Validate({
        // Type-safe store rules: keys are RELATIVE to the store and
        // compile-time checked against SubmitFormState. The decorator
        // auto-prefixes them to full runtime paths
        // ('submitFormStore.email', 'submitFormStore.address.zip', ...).
        // A typo like `emial: { ... }` would fail to compile.
        rules: storeRules<SubmitFormState>({
            email: { required: true, email: true, message: 'Please enter a valid email address' },
            password: { required: true, minLength: 8, message: 'Password must be at least 8 characters' },
            age: { required: true, min: 18, max: 120, message: 'Please enter a valid age (18-120)' },
            username: { required: true, pattern: /^[a-zA-Z0-9_]+$/, message: 'Username can only contain letters, numbers, and underscores' },
            website: { url: true, message: 'Please enter a valid URL' },
            discountCode: {
                required: false,
                customAsync: async (value: string, component: any) => {
                    // Skip validation if empty (not required). Demonstrates that
                    // customAsync resolves the nested value correctly.
                    if (!value || value.trim() === '') return true;
                    try {
                        return await component.validateDiscountCode(value);
                    } catch (e) {
                        console.error('Validation error:', e);
                        return false;
                    }
                },
                message: 'Invalid discount code',
            },
            // Deep dot-path into a nested object (relative form: 'address.zip').
            'address.zip': {
                required: true,
                pattern: /^\d{4,10}$/,
                message: 'Please enter a valid ZIP code (4-10 digits)',
            },
            'address.country': {
                required: true,
                minLength: 2,
                message: 'Please enter your country',
            },
            // Array field — validates non-empty (arrays are addressable by key).
            tags: {
                required: true,
                minLength: 1,
                message: 'Add at least one tag',
            },
        }),
        config: { trigger: 'all', runOn: 'both' },
    })
    submitFormStore: SubmitFormState = {
        email: '',
        password: '',
        age: '',
        username: '',
        website: '',
        discountCode: '',
        address: { zip: '', country: '' },
        tags: [],
    };

    // A scalar field — @State is the appropriate choice (no nested mutation).
    @State()
    newTag: string = '';

    @Store()
    errors: Record<string, string> = {};

    @Store()
    submitted: boolean = false;

    @Store()
    formData: Record<string, unknown> = {};

    // Server method to validate discount codes.
    @Server()
    async validateDiscountCode(code: string): Promise<boolean> {
        // Simulate server-side validation (e.g., database lookup).
        await new Promise(resolve => setTimeout(resolve, 100));
        const validCodes = ['SAVE10', 'SAVE20', 'WELCOME', 'VIP50', 'FREESHIP'];
        return validCodes.includes(code.toUpperCase());
    }

    public head(context: HeadContext): HeadValue {
        return {
            title: 'Store Validation Demo',
        };
    }

    @Client()
    handleInput(field: string, event: Event) {
        const target = event.target as HTMLInputElement;
        // Direct nested assignment — the store Proxy makes this reactive.
        (this.submitFormStore as any)[field] = target.value;
        this.validateProperty(`submitFormStore.${field}`, 'input');
    }

    @Client()
    handleNestedInput(section: string, field: string, event: Event) {
        const target = event.target as HTMLInputElement;
        // Deep nested assignment — exercises multi-level reactivity.
        (this.submitFormStore as any)[section][field] = target.value;
        this.validateProperty(`submitFormStore.${section}.${field}`, 'input');
    }

    @Client()
    handleBlur(path: string, _event: Event) {
        this.validateProperty(path, 'blur');
    }

    @Client()
    addTag(event: Event) {
        event.preventDefault();
        const tag = this.newTag.trim();
        if (!tag) return;
        // Array mutation — exercises array Proxy reactivity.
        this.submitFormStore.tags.push(tag);
        this.newTag = '';
        this.validateProperty('submitFormStore.tags', 'input');
    }

    @Client()
    removeTag(index: number) {
        this.submitFormStore.tags.splice(index, 1);
        this.validateProperty('submitFormStore.tags', 'input');
    }

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.submitted = false;

        // Validate every registered rule (flat + dot-paths).
        const isValid = await this.validateAll();

        if (isValid) {
            this.submitted = true;
            this.formData = {
                email: this.submitFormStore.email,
                username: this.submitFormStore.username,
                age: this.submitFormStore.age,
                website: this.submitFormStore.website,
                discountCode: this.submitFormStore.discountCode || '(none)',
                address: { ...this.submitFormStore.address },
                tags: [...this.submitFormStore.tags],
            };
            this.clearErrors();
            this.requestUpdate();
        }
    }

    render(): TemplateResult {
        return html`
            <div class="max-w-[600px] mx-auto p-8">
                <h1>Store Validation Demo</h1>
                <p>This page demonstrates the <code>@Store</code> decorator with nested <code>@Validate</code> rules (dot-paths).</p>

                <form @submit="${(e: Event) => this.handleSubmit(e)}">
                    <!-- Email -->
                    <div class="mb-4">
                        <label for="email" class="block mb-2">Email (required, email)</label>
                        <input
                            type="email"
                            id="email"
                            .value="${this.submitFormStore.email}"
                            @input="${(e: Event) => this.handleInput('email', e)}"
                            @blur="${(e: Event) => this.handleBlur('submitFormStore.email', e)}"
                            class="w-full p-2 border rounded ${this.hasError('submitFormStore.email') ? 'border-red-500' : 'border-gray-300'}"
                        />
                        ${this.hasError('submitFormStore.email') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.email')}</span>` : ''}
                    </div>

                    <!-- Password -->
                    <div class="mb-4">
                        <label for="password" class="block mb-2">Password (required, minLength: 8)</label>
                        <input
                            type="password"
                            id="password"
                            .value="${this.submitFormStore.password}"
                            @input="${(e: Event) => this.handleInput('password', e)}"
                            @blur="${(e: Event) => this.handleBlur('submitFormStore.password', e)}"
                            class="w-full p-2 border rounded ${this.hasError('submitFormStore.password') ? 'border-red-500' : 'border-gray-300'}"
                        />
                        ${this.hasError('submitFormStore.password') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.password')}</span>` : ''}
                    </div>

                    <!-- Username -->
                    <div class="mb-4">
                        <label for="username" class="block mb-2">Username (required, pattern: alphanumeric + underscore)</label>
                        <input
                            type="text"
                            id="username"
                            .value="${this.submitFormStore.username}"
                            @input="${(e: Event) => this.handleInput('username', e)}"
                            @blur="${(e: Event) => this.handleBlur('submitFormStore.username', e)}"
                            class="w-full p-2 border rounded ${this.hasError('submitFormStore.username') ? 'border-red-500' : 'border-gray-300'}"
                        />
                        ${this.hasError('submitFormStore.username') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.username')}</span>` : ''}
                    </div>

                    <!-- Age -->
                    <div class="mb-4">
                        <label for="age" class="block mb-2">Age (required, min: 18, max: 120)</label>
                        <input
                            type="number"
                            id="age"
                            .value="${this.submitFormStore.age}"
                            @input="${(e: Event) => this.handleInput('age', e)}"
                            @blur="${(e: Event) => this.handleBlur('submitFormStore.age', e)}"
                            class="w-full p-2 border rounded ${this.hasError('submitFormStore.age') ? 'border-red-500' : 'border-gray-300'}"
                        />
                        ${this.hasError('submitFormStore.age') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.age')}</span>` : ''}
                    </div>

                    <!-- Website -->
                    <div class="mb-4">
                        <label for="website" class="block mb-2">Website (url)</label>
                        <input
                            type="url"
                            id="website"
                            .value="${this.submitFormStore.website}"
                            @input="${(e: Event) => this.handleInput('website', e)}"
                            @blur="${(e: Event) => this.handleBlur('submitFormStore.website', e)}"
                            class="w-full p-2 border rounded ${this.hasError('submitFormStore.website') ? 'border-red-500' : 'border-gray-300'}"
                        />
                        ${this.hasError('submitFormStore.website') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.website')}</span>` : ''}
                    </div>

                    <!-- Discount Code (customAsync) -->
                    <div class="mb-4">
                        <label for="discountCode" class="block mb-2">Discount Code (optional, async server validation)</label>
                        <input
                            type="text"
                            id="discountCode"
                            placeholder="Try: SAVE10, SAVE20, WELCOME, VIP50"
                            .value="${this.submitFormStore.discountCode}"
                            @input="${(e: Event) => this.handleInput('discountCode', e)}"
                            @blur="${(e: Event) => this.handleBlur('submitFormStore.discountCode', e)}"
                            class="w-full p-2 border rounded ${this.hasError('submitFormStore.discountCode') ? 'border-red-500' : 'border-gray-300'}"
                        />
                        ${this.hasError('submitFormStore.discountCode') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.discountCode')}</span>` : ''}
                        <small class="text-gray-500 text-xs">Valid codes: SAVE10, SAVE20, WELCOME, VIP50</small>
                    </div>

                    <!-- Nested object: address (deep reactivity) -->
                    <fieldset class="mb-4 border p-4 rounded">
                        <legend class="px-2 font-bold">Address (nested object — deep reactivity)</legend>
                        <div class="mb-2">
                            <label for="zip" class="block mb-2">ZIP (required, 4-10 digits)</label>
                            <input
                                type="text"
                                id="zip"
                                .value="${this.submitFormStore.address.zip}"
                                @input="${(e: Event) => this.handleNestedInput('address', 'zip', e)}"
                                @blur="${(e: Event) => this.handleBlur('submitFormStore.address.zip', e)}"
                                class="w-full p-2 border rounded ${this.hasError('submitFormStore.address.zip') ? 'border-red-500' : 'border-gray-300'}"
                            />
                            ${this.hasError('submitFormStore.address.zip') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.address.zip')}</span>` : ''}
                        </div>
                        <div class="mb-2">
                            <label for="country" class="block mb-2">Country (required)</label>
                            <input
                                type="text"
                                id="country"
                                .value="${this.submitFormStore.address.country}"
                                @input="${(e: Event) => this.handleNestedInput('address', 'country', e)}"
                                @blur="${(e: Event) => this.handleBlur('submitFormStore.address.country', e)}"
                                class="w-full p-2 border rounded ${this.hasError('submitFormStore.address.country') ? 'border-red-500' : 'border-gray-300'}"
                            />
                            ${this.hasError('submitFormStore.address.country') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.address.country')}</span>` : ''}
                        </div>
                    </fieldset>

                    <!-- Array field: tags (array mutation reactivity) -->
                    <fieldset class="mb-4 border p-4 rounded">
                        <legend class="px-2 font-bold">Tags (array — push/splice reactivity)</legend>
                        <div class="flex gap-2 mb-2">
                            <input
                                type="text"
                                .value="${this.newTag}"
                                @input="${(e: Event) => this.newTag = (e.target as HTMLInputElement).value}"
                                placeholder="Add a tag"
                                class="flex-1 p-2 border rounded border-gray-300"
                            />
                            <button type="button" class="px-4 py-2 bg-gray-200 rounded" @click="${(e: Event) => this.addTag(e)}">Add</button>
                        </div>
                        <div>
                            ${this.submitFormStore.tags.map((tag, i) => html`
                                <span class="inline-flex items-center gap-2 mr-2 mb-2 px-2 py-1 bg-gray-100 rounded">
                                    ${tag}
                                    <button type="button" class="text-red-500" @click="${() => this.removeTag(i)}">×</button>
                                </span>
                            `)}
                        </div>
                        ${this.hasError('submitFormStore.tags') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.tags')}</span>` : ''}
                    </fieldset>

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
