import { component, html, type TemplateResult } from '@cossackframework/renderer';
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
import { Alert, Badge, Button, Input, Label, Typography } from '@cossackframework/ui';

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
        // Type-safe store rules: a NESTED tree that mirrors the store shape.
        // Object fields nest a sub-tree; primitive/array fields take a rule.
        // The decorator flattens relative keys to full runtime paths
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
            // Nested object — rules mirror the field shape (relative: 'address.zip').
            address: {
                zip: {
                    required: true,
                    pattern: /^\d{4,10}$/,
                    message: 'Please enter a valid ZIP code (4-10 digits)',
                },
                country: {
                    required: true,
                    minLength: 2,
                    message: 'Please enter your country',
                },
            },
            // Array field — validated as a whole (arrays are addressable by key).
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
            <div class="max-w-150 mx-auto p-8">
                ${component(Typography, { variant: 'h1' }, 'Store Validation Demo')}
                <p>This page demonstrates the <code>@Store</code> decorator with nested <code>@Validate</code> rules (dot-paths).</p>

                <form @submit="${(e: Event) => this.handleSubmit(e)}">
                    <!-- Email -->
                    <div class="mb-4">
                        ${component(Label, { for: 'email' }, 'Email (required, email)')}
                        ${component(Input, {
                            type: 'email', id: 'email', '.value': this.submitFormStore.email,
                            variant: this.hasError('submitFormStore.email') ? 'error' : 'default',
                            '@input': (e: Event) => this.handleInput('email', e),
                            '@blur': (e: Event) => this.handleBlur('submitFormStore.email', e),
                        })}
                        ${this.hasError('submitFormStore.email') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.email')}</span>` : ''}
                    </div>

                    <!-- Password -->
                    <div class="mb-4">
                        ${component(Label, { for: 'password' }, 'Password (required, minLength: 8)')}
                        ${component(Input, {
                            type: 'password', id: 'password', '.value': this.submitFormStore.password,
                            variant: this.hasError('submitFormStore.password') ? 'error' : 'default',
                            '@input': (e: Event) => this.handleInput('password', e),
                            '@blur': (e: Event) => this.handleBlur('submitFormStore.password', e),
                        })}
                        ${this.hasError('submitFormStore.password') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.password')}</span>` : ''}
                    </div>

                    <!-- Username -->
                    <div class="mb-4">
                        ${component(Label, { for: 'username' }, 'Username (required, pattern: alphanumeric + underscore)')}
                        ${component(Input, {
                            type: 'text', id: 'username', '.value': this.submitFormStore.username,
                            variant: this.hasError('submitFormStore.username') ? 'error' : 'default',
                            '@input': (e: Event) => this.handleInput('username', e),
                            '@blur': (e: Event) => this.handleBlur('submitFormStore.username', e),
                        })}
                        ${this.hasError('submitFormStore.username') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.username')}</span>` : ''}
                    </div>

                    <!-- Age -->
                    <div class="mb-4">
                        ${component(Label, { for: 'age' }, 'Age (required, min: 18, max: 120)')}
                        ${component(Input, {
                            type: 'number', id: 'age', '.value': this.submitFormStore.age,
                            variant: this.hasError('submitFormStore.age') ? 'error' : 'default',
                            '@input': (e: Event) => this.handleInput('age', e),
                            '@blur': (e: Event) => this.handleBlur('submitFormStore.age', e),
                        })}
                        ${this.hasError('submitFormStore.age') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.age')}</span>` : ''}
                    </div>

                    <!-- Website -->
                    <div class="mb-4">
                        ${component(Label, { for: 'website' }, 'Website (url)')}
                        ${component(Input, {
                            type: 'url', id: 'website', '.value': this.submitFormStore.website,
                            variant: this.hasError('submitFormStore.website') ? 'error' : 'default',
                            '@input': (e: Event) => this.handleInput('website', e),
                            '@blur': (e: Event) => this.handleBlur('submitFormStore.website', e),
                        })}
                        ${this.hasError('submitFormStore.website') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.website')}</span>` : ''}
                    </div>

                    <!-- Discount Code (customAsync) -->
                    <div class="mb-4">
                        ${component(Label, { for: 'discountCode' }, 'Discount Code (optional, async server validation)')}
                        ${component(Input, {
                            type: 'text', id: 'discountCode', placeholder: 'Try: SAVE10, SAVE20, WELCOME, VIP50',
                            '.value': this.submitFormStore.discountCode,
                            variant: this.hasError('submitFormStore.discountCode') ? 'error' : 'default',
                            '@input': (e: Event) => this.handleInput('discountCode', e),
                            '@blur': (e: Event) => this.handleBlur('submitFormStore.discountCode', e),
                        })}
                        ${this.hasError('submitFormStore.discountCode') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.discountCode')}</span>` : ''}
                        <small class="text-gray-500 text-xs">Valid codes: SAVE10, SAVE20, WELCOME, VIP50</small>
                    </div>

                    <!-- Nested object: address (deep reactivity) -->
                    <fieldset class="mb-4 border p-4 rounded">
                        <legend class="px-2 font-bold">Address (nested object — deep reactivity)</legend>
                        <div class="mb-2">
                            ${component(Label, { for: 'zip' }, 'ZIP (required, 4-10 digits)')}
                            ${component(Input, {
                                type: 'text', id: 'zip', '.value': this.submitFormStore.address.zip,
                                variant: this.hasError('submitFormStore.address.zip') ? 'error' : 'default',
                                '@input': (e: Event) => this.handleNestedInput('address', 'zip', e),
                                '@blur': (e: Event) => this.handleBlur('submitFormStore.address.zip', e),
                            })}
                            ${this.hasError('submitFormStore.address.zip') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.address.zip')}</span>` : ''}
                        </div>
                        <div class="mb-2">
                            ${component(Label, { for: 'country' }, 'Country (required)')}
                            ${component(Input, {
                                type: 'text', id: 'country', '.value': this.submitFormStore.address.country,
                                variant: this.hasError('submitFormStore.address.country') ? 'error' : 'default',
                                '@input': (e: Event) => this.handleNestedInput('address', 'country', e),
                                '@blur': (e: Event) => this.handleBlur('submitFormStore.address.country', e),
                            })}
                            ${this.hasError('submitFormStore.address.country') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.address.country')}</span>` : ''}
                        </div>
                    </fieldset>

                    <!-- Array field: tags (array mutation reactivity) -->
                    <fieldset class="mb-4 border p-4 rounded">
                        <legend class="px-2 font-bold">Tags (array — push/splice reactivity)</legend>
                        <div class="flex gap-2 mb-2">
                            ${component(Input, {
                                type: 'text', '.value': this.newTag, placeholder: 'Add a tag',
                                '@input': (e: Event) => this.newTag = (e.target as HTMLInputElement).value,
                            })}
                            ${component(Button, { type: 'button', variant: 'secondary', '@click': this.addTag }, 'Add')}
                        </div>
                        <div>
                            ${this.submitFormStore.tags.map((tag, i) => html`
                                ${component(Badge, { variant: 'secondary', class: 'mr-2 mb-2' }, html`
                                    ${tag}
                                    ${component(Button, {
                                        type: 'button', variant: 'ghost', size: 'icon',
                                        'aria-label': `Remove ${tag}`, '@click': () => this.removeTag(i),
                                    }, '×')}
                                `)}
                            `)}
                        </div>
                        ${this.hasError('submitFormStore.tags') ? html`<span class="text-red-500 text-sm">${this.getError('submitFormStore.tags')}</span>` : ''}
                    </fieldset>

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
