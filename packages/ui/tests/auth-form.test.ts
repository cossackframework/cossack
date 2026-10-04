import { expect, it } from 'vitest';
import { renderToString } from '@cossackframework/renderer';
import { AuthForm, type AuthFormProps } from '../src/blocks/AuthForm/index';
function fixture(props: Record<string, unknown> = {}) {
    const form = new AuthForm();
    form.props = { id: 'account', onSubmit: () => {}, ...props } as AuthFormProps;
    return form;
}
it('renders signup on the server with instance-owned native field labels and constraints', () => {
    const out = renderToString(fixture({ defaultMode: 'signup' }).render());
    for (const field of ['email', 'password', 'name']) {
        expect(out).toContain(`id="account-${field}"`);
        expect(out).toContain(`for="account-${field}"`);
        expect(out).toContain(`name="${field}"`);
    }
    expect(out).toContain('autocomplete="new-password"');
    expect(out).toContain('minlength="8"');
    expect(out).toContain('method="post"');
    expect(out).toMatch(/type="submit"[^>]*disabled/);
    expect(out).toContain('Enable JavaScript to use this form.');
    expect(out).not.toContain('Google');
});
it('keeps login password rules separate and forwards explicit native targets', () => {
    const out = renderToString(fixture({ class: 'custom', 'data-root': 'root', formProps: { 'data-form': 'form', autocomplete: 'off' } }).render());
    expect(out).toContain('autocomplete="current-password"');
    expect(out).not.toContain('minlength=');
    expect(out).not.toContain('name="name"');
    expect(out).toContain('data-root="root"');
    expect(out).toContain('data-form="form"');
    expect(out).toContain('autocomplete="off"');
});
it('captures default mode once and follows controlled mode props', () => {
    const uncontrolled = fixture({ defaultMode: 'signup' });
    expect(renderToString(uncontrolled.render())).toContain('name="name"');
    uncontrolled.props = { ...uncontrolled.props, defaultMode: 'login' } as AuthFormProps;
    expect(renderToString(uncontrolled.render())).toContain('name="name"');
    const controlled = fixture({ mode: 'signup', onModeChange: () => {} });
    controlled.render(); controlled.props = { ...controlled.props, mode: 'login' } as AuthFormProps;
    expect(renderToString(controlled.render())).not.toContain('name="name"');
});
it('requires explicit provider actions and escapes localized text', () => {
    const out = renderToString(fixture({ providers: [{ id: 'enterprise', label: '<SSO>' }], onSocial: () => {}, labels: { loginTitle: '<Welcome>' } }).render());
    expect(out).toContain('&lt;SSO&gt;'); expect(out).toContain('&lt;Welcome&gt;');
    expect(out).toContain('data-provider="enterprise"');
});
it.each([
    { id: '' }, { id: 'a b' }, { onSubmit: undefined }, { mode: 'other' }, { mode: 'login' },
    { mode: 'login', defaultMode: 'signup', onModeChange: () => {} },
    { providers: [{ id: 'x', label: 'X' }] }, { providers: [{ id: 'x', label: '' }], onSocial: () => {} },
    { providers: [{ id: 'x', label: 'X' }, { id: 'x', label: 'Y' }], onSocial: () => {} },
    { signupPasswordMinLength: 0 }, { signupPasswordMinLength: 1.2 }, { labels: { email: '' } },
])('rejects invalid contract %j', props => expect(() => fixture(props).render()).toThrow());
