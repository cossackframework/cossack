# Cossack Framework DX Improvements Plan

## Future Improvements

---

### 6. Form Validation

**Goal:** Integrated form validation with decorators.

```typescript
@Component()
export class LoginForm extends Cossack {
    @Prop() onSubmit!: (data: { email: string; password: string }) => void;

    @State()
    @Validate({ email: true, required: true })
    email = '';

    @State()
    @Validate({ minLength: 8, required: true })
    password = '';

    @State()
    errors: Record<string, string> = {};

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
