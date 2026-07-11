---
title: "Advanced Forms Handling"
description: "Learn how to create and handle advanced forms in Cossack, including nested fields, arrays, and complex validation rules."
---

# Advanced Forms Handling

Traditional forms are great for simple use cases, but what if your forms has a lot of interactions, ajax requests, client-side validation, etc. Cossack provides a way to simplify them.

## Defining Complex Fields

If you define each field in a separate state, your code will be messy and hard to maintain. Instead, you can define a single state object that contains all the form fields. This called `@Store()` in Cossack.

Here is the basic example of a complex form with many fields, some nested, and some arrays:

```typescript
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
```

Now in your page component, you can define a `@Store()` state for the form:

```typescript
export class StoreValidationDemo extends Cossack {
    @Store()
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
}
```


## Validation

Our [Validation](./validation.md) support both `@Store()` and `@State()` fields. Just decorate your store with `@Validate()` and provide a validation schema. Your store now becomes:

```typescript
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

// Server-side validation method for discount codes
@Server()
async validateDiscountCode(code: string): Promise<boolean> {
    // Simulate server-side validation (e.g., database lookup).
    await new Promise(resolve => setTimeout(resolve, 100));
    const validCodes = ['SAVE10', 'SAVE20', 'WELCOME', 'VIP50', 'FREESHIP'];
    return validCodes.includes(code.toUpperCase());
}
```


## Form and Field Templates

Now define your own form in the `render()` method with `@submit` event handler that point to the `@Server()` handler method. Since the `@submit` event is a native event which causes the page reload, we have a helper function `preventDefault()` to prevent the default behavior and call the handler method instead.
Otherwise, you can still call `@submit=${e => { e.preventDefault(); this.handleSubmit(); }` but the helper function is more convenient.

```ts
@Server()
async handleSubmit() {
    console.log('Form submitted:', this.submitFormStore);
}

render() {
    return html`
        <form @submit=${preventDefault(this.handleSubmit)}>
            ...
        </form>
    `;
}
```

Then, each field can be defined like so:

```html
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
```

As you can see, we listen to the `@input` event to update the store value and the `@blur` event to trigger validation on every field, so we can avoid repetitive code by creating a helper methods `handleInput()` and `handleBlur()` to handle the events for all fields. Those methods are defined in the page component like so:

```ts
@Client()
handleInput(field: string, event: Event) {
    const target = event.target as HTMLInputElement;
    // Direct nested assignment — the store Proxy makes this reactive.
    (this.submitFormStore as any)[field] = target.value;
    this.validateProperty(`submitFormStore.${field}`, 'input');
}

@Client()
handleBlur(path: string, _event: Event) {
    this.validateProperty(path, 'blur');
}
```

## Put it all together

Here is our complete page component with the form, validation, and submission handling: https://github.com/cossackframework/cossack/blob/master/packages/framework/src/pages/store-validation/index.ts