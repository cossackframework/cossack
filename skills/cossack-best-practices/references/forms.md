# Forms

Cossack has **two** built-in form patterns. **Do not wire up `fetch()` to submit a form or roll your own validation state** — pick the pattern that fits and use the framework support.

| Pattern | How it works | Reach for it when… |
|---|---|---|
| **Progressive** (traditional) | `<form method="post">` + a `post()` handler + `flash`/`old` helpers. Full POST → redirect → GET cycle; works without JS. | SEO-friendly pages, public forms (contact, login, signup), anything that should work over a slow connection or with JS disabled. |
| **Reactive** (AJAX-style) | `@Store()` + `@Validate()` + `@Client()` input handlers + a `@Server()` submit. No page reload; client-side validation with server-side rules. | Dashboards, multi-step forms, anything with inline async validation or live previews. |

Both share the same validation engine and the same `storeRules<T>()` schema. The difference is the *flow*: progressive does a round trip; reactive stays on the page.

For full prose guides, see `docs/forms.md` (progressive) and `docs/forms-advanced.md` (reactive).

---

## Pattern 1 — Progressive forms (POST + redirect)

A plain HTML `<form>` POSTs to the same URL; a `post()` method on the page handles it server-side. This requires `transport: 'http'` on the `@Page` decorator.

```typescript
import { Cossack, Page, State, flash, flashed, old, type NestedErrors } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

interface ContactFields { name: string; email: string; }

@Page({ transport: 'http' })
export default class ContactForm extends Cossack {
    @State() success: string | undefined;
    @State() errors: NestedErrors<ContactFields> | undefined;
    @State() name = '';
    @State() email = '';

    async init() {
        // Read flashed data on the GET that follows the redirect.
        this.success = flashed<string>('success');
        this.errors = flashed('errors');
        this.name = old<string>('name') ?? '';
        this.email = old<string>('email') ?? '';
    }

    async post() {
        // getFormData() auto-flashes the submitted input (for old()) and the
        // errors (when invalid) — no manual flashInput()/flash('errors') needed.
        const { data, valid } = await this.c.getFormData<ContactFields>({
            rules: {
                name: { required: true, message: 'Name is required' },
                email: { required: true, email: true, message: 'Enter a valid email' },
            },
        });

        if (!valid) {
            return this.back();                // errors + old input auto-flashed
        }

        // …persist data, send email, etc.…
        flash('success', 'Thanks! We will be in touch.');
        return this.c.redirect('/contact');    // PRG: redirect after POST
    }

    render() {
        return html`
            <form method="post" novalidate>
                <input name="name" .value="${this.name}" />
                ${this.hasError('name') ? html`<span>${this.getError('name')}</span>` : ''}
                <input name="email" type="email" .value="${this.email}" />
                ${this.hasError('email') ? html`<span>${this.getError('email')}</span>` : ''}
                <button type="submit">Send</button>
            </form>
            ${this.success ? html`<p>${this.success}</p>` : ''}
        `;
    }
}
```

### Auto-flash in `getFormData()`

When `rules` are provided, `getFormData()` **auto-flashes** the submitted input and any validation errors to the next request by default — so the common POST→redirect→GET form flow needs no manual `flashInput()`/`flash('errors', …)`. Control it with the `flash` option:

- `true` (default) — flash both input (for `old()`) and errors (only when non-empty).
- `false` — flash nothing (do it yourself with the helpers below).
- `{ input: false }` / `{ errors: false }` — toggle each category; unspecified keys default to `true`.

Errors are only flashed when there actually are any, so truthy checks like `${this.errors ? …}` never render an error banner on a valid submit.

### Error helpers

`hasError(path)` / `getError(path)` read the flashed `errors` object. They accept **dot-paths**, so nested fields work the same as top-level ones — no optional-chaining into `errors.address.city`:

```typescript
this.hasError('name')            // top-level
this.hasError('address.city')    // nested — works
this.getError('address.city')    // → 'City is required'
```

They also resolve flat dot-path keys written by the `@Validate` reactive path (Pattern 2), so the same calls work in both patterns.

### The flash / old-input helpers

All imported from `@cossackframework/core`. **Writers** go in `post()`; **readers** go in `init()`. Use these directly only when you're not relying on `getFormData()`'s auto-flash (e.g. a success message, or `{ flash: false }`).

| Helper | Direction | Signature | Purpose |
|---|---|---|---|
| `flash(key, value)` | write | `(key: string, value: unknown) => void` | Stash a value for the *next* request. Also accepts a record: `flash({ errors, success })`. |
| `flashed<T>(key)` | read | `(key: string) => T \| undefined` | Read a value flashed by the *previous* request. |
| `flashInput(data)` | write | `(data: Record<string, unknown>) => void` | Stash submitted input for repopulation. |
| `old<T>(key)` | read | `(key: string) => T \| undefined` | Read a previously flashed input field. Supports dot-paths (`old('address.city')`). |

> **Common mistake:** `flash()` is **write-only** and `flashInput()` is **write-only**. To *read*, use `flashed(key)` and `old(key)` respectively. Calling `flash('success')` with one argument writes `undefined` — it does not read.

### `this.c.getFormData<T>(opts?)`

Server-only (throws on the client). Parses `application/x-www-form-urlencoded` / `multipart` body into a typed object, and optionally validates it.

```typescript
// Parse only:
const data = await this.c.getFormData<ContactFields>();

// Parse + validate (auto-flashes input + errors by default):
const { data, valid } = await this.c.getFormData<ContactFields>({
    rules: { /* StoreRuleMap<ContactFields> */ },
    flash: false,   // opt out of auto-flash if you need manual control
});
```

Nested fields use PHP-style square brackets in the HTML (`name="address[city]"`) and dot-paths in the rules (`'address.city'`). On a validation failure, `errors` is a nested object matching `T`; `valid` is `false`.

### HTTP method handlers

`post()`, `put()`, `patch()`, `delete()` methods on a page are auto-registered as handlers for the corresponding HTTP methods at the page's route (requires `transport: 'http'`). Return a `Response` (e.g. `this.back()`, `this.c.redirect(...)`) to control the response; return nothing and the page's public state is serialized as JSON.

---

## Pattern 2 — Reactive forms (`@Store` + `@Validate`)

No page reload. A `@Store()` holds the form object (so nested mutations are reactive); `@Validate()` with a `storeRules<T>()` map runs validation on **both** client and server; `@Client()` handlers update fields and trigger per-field validation; a `@Server()` method handles submit.

```typescript
import { Cossack, Page, Store, Validate, Client, Server, storeRules } from '@cossackframework/core';
import { html, preventDefault } from '@cossackframework/renderer';

interface FormState {
    email: string;
    password: string;
    address: { zip: string };
}

@Page({ transport: 'http' })
export class ReactiveForm extends Cossack {
    @Store()
    @Validate({
        rules: storeRules<FormState>({
            email: { required: true, email: true, message: 'Enter a valid email' },
            password: { required: true, minLength: 8, message: 'Min 8 characters' },
            address: { zip: { required: true, pattern: /^\d{4,10}$/, message: 'Invalid ZIP' } },
        }),
        config: { trigger: 'all', runOn: 'both' },
    })
    form: FormState = { email: '', password: '', address: { zip: '' } };

    @Store() errors: Record<string, string> = {};   // must be declared — see validation.md

    // Field updates — @Store's deep Proxy makes nested assignment reactive.
    @Client()
    handleInput(field: string, event: Event) {
        (this.form as any)[field] = (event.target as HTMLInputElement).value;
        this.validateProperty(`form.${field}`, 'input');
    }

    @Client()
    handleBlur(path: string) {
        this.validateProperty(path, 'blur');
    }

    @Server()
    async handleSubmit() {
        const isValid = await this.validateAll();
        if (!isValid) return;
        // …persist…
    }

    render() {
        return html`
            <form @submit="${preventDefault(this.handleSubmit)}">
                <input .value="${this.form.email}"
                       @input="${(e: Event) => this.handleInput('email', e)}"
                       @blur="${() => this.handleBlur('form.email')}" />
                ${this.hasError('form.email') ? html`<span>${this.getError('form.email')}</span>` : ''}
                <button type="submit" ?disabled="${this.loading.handleSubmit}">Save</button>
            </form>
        `;
    }
}
```

Key points:

- **`preventDefault(handler)`** — imported from `@cossackframework/renderer`. Wraps a `@submit` handler so the native form submission (full reload) is suppressed and your handler runs instead. Accepts an optional `{ novalidate?: boolean }` (defaults to `true`, disabling HTML5 native validation). Without it, `<form @submit>` will reload the page.
- **`@Store()`** makes `this.form.email = …`, `this.form.address.zip = …`, and `this.form.tags.push(…)` all reactive without reassigning the whole object. See `references/decorators.md`.
- **`storeRules<T>()`** gives compile-time-checked keys; keys are relative to the store property and auto-prefixed at runtime (`'email'` → `'form.email'`). See `references/validation.md`.
- **`this.loading.handleSubmit`** — auto-tracked because `handleSubmit` is a `@Server()` method. See `references/loading.md`.

### When to pick reactive over progressive

Use **reactive** when you need inline async validation (e.g. "username available?"), live-computed fields, multi-step wizards, or you're already in a dashboard that never does full reloads. Use **progressive** when the form should be crawlable, bookmarkable, or usable without JS — public contact forms, auth pages, SEO landing pages.
