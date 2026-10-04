import { expect, it, vi } from 'vitest';
import { component, html, renderToString } from '@cossackframework/renderer';
import { Field } from '../src/components/Field';
import { Empty } from '../src/components/Empty';
import { Input } from '../src/components/Input';
import { PasswordInput } from '../src/components/PasswordInput';

it('links the native label, hint, error and required state through one callback', () => {
    const control = vi.fn(attributes => component(Input, { ...attributes, name: 'email' }));
    const output = renderToString(component(Field, { label: 'Email', for: 'email', id: 'email-field', hint: 'Use work email', error: 'Invalid address', required: true, control }));
    expect(control).toHaveBeenCalledWith({id:'email', required:true, 'aria-describedby':'email-hint email-error', 'aria-invalid':'true'});
    expect(output).toContain('for="email"');
    expect(output).toContain('id="email-field"');
    expect(output).toContain('id="email-hint"');
    expect(output).toContain('id="email-error"');
    expect(output).toContain('aria-describedby="email-hint email-error"');
    expect(output).toContain('aria-invalid="true"');
    expect(output).toContain('aria-hidden="true"');
    expect(output).not.toMatch(/\s(?:hint|error|control)=/);
});
it('omits empty descriptions and links composed password inputs to their actual field', () => {
    const output = renderToString(component(Field, { label: 'Password', for: 'password', hint: ' ', error: '', control: attrs => component(PasswordInput, {...attrs, name:'password'}) }));
    expect(output).toMatch(/<input[^>]*id="password"/);
    expect(output).toContain('for="password"');
    expect(output).not.toContain('aria-describedby');
    expect(output).not.toContain('aria-invalid=');
    expect(output).not.toContain('id="password-hint"');
});
it.each([{for:''}, {for:'two ids'}, {label:''}, {control:undefined}, {hint:4}, {required:'yes'}])('rejects invalid field contracts', patch => {
    expect(() => renderToString(component(Field, {label:'Email',for:'email',control:()=>'',...patch} as any))).toThrow('Field');
});
it('rejects separate control children instead of silently dropping them', () => {
    expect(() => renderToString(component(Field, {label:'Email',for:'email',control:()=>''}, 'ignored'))).toThrow('separate children');
});
it('forwards native Empty attributes and preserves caller-owned actions and content', () => {
    const output = renderToString(component(Empty, {id:'empty',class:'custom','data-kind':'search',title:'No matches',description:'Try another search',icon:html`<span aria-hidden="true">?</span>`},html`<button type="button">Clear</button><a href="/help">Help</a>`));
    expect(output).toContain('id="empty"');
    expect(output).toContain('custom');
    expect(output).toContain('data-kind="search"');
    expect(output).toContain('No matches');
    expect(output).toContain('<button type="button">Clear</button>');
    expect(output).toContain('<a href="/help">Help</a>');
    expect(output).not.toMatch(/\s(?:title|description|icon)=/);
    expect(output).not.toContain('role="button"');
});
