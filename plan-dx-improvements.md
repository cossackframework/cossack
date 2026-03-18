# Cossack Validation Plan

Currently, Cossack does not have built-in support for form validation. To improve the developer experience, we can introduce a validation system that allows developers to easily define validation rules using decorators.

Refer to the architecture document for more details on how this could be implemented.

## Considerations
- `@State` properties are currently used for both client and server state. If we put `@Validate` on a `@State` property. It should validate on both client and server. This means that we need to ensure that the validation logic is available on both sides. Or, we can allow developers to specify where the validation should run (client, server, or both) as an option in the `@Validate` decorator.
- `@ClientState` properties are only used for client state. If we put `@Validate` on a `@ClientState` property, it should only validate on the client.
- We need to decide how to handle validation errors. We could store them in a separate `@State` property?
- How do we want to handle asynchronous/custom logic validation? For example, if we want to check if an email is already taken, we would need to make an API call. We could allow the validation function to return a promise and handle it accordingly.
- We need to decide how to trigger validation. Should it be on input, on blur, or on form submit? We could allow developers to specify this as an option in the `@Validate` decorator.

## Proposed API
This is just my initial idea for how the API could look. We can iterate on this based on feedback.

```typescript
@Component()
export class LoginForm extends Cossack {
    @State()
    @Validate({ email: true, required: true, message: 'Please enter a valid email address' })
    email = '';

    @State()
    @Validate({ minLength: 8, required: true, message: 'Password must be at least 8 characters long' })
    password = '';

    @State()
    errors: Record<string, string> = {};

    @Client()
    handleSubmit(e: Event) {
        // Handle submit logic
    }

    render() {
        return html`
            <form @submit="${this.handleSubmit}">
                <input type="email" @input="${e => this.email = e.target.value}" />
                ${this.errors.email ? html`<error>${this.errors.email}</error>` : ''}

                <input type="password" @input="${e => this.password = e.target.value}" />
                ${this.errors.password ? html`<error>${this.errors.password}</error>` : ''}
            </form>
        `;
    }
}
```
