import { expect, expectTypeOf, it } from 'vitest';
import { createFormController, input } from '@cossackframework/core';
import { renderToString } from '@cossackframework/renderer';
import { createUiFormBindings } from '../src/form-bindings';
import { Form } from '../src/components/Form';
import { Input } from '../src/components/Input';
import { Checkbox } from '../src/components/Checkbox';
const fixture = () => {
  const controller = createFormController(input.object({ name: input.string(), enabled: input.boolean() }), { name: 'Ada', enabled: true });
  return { controller, bindings: createUiFormBindings(controller, { id: 'account' }) };
};
it('adapts shared field errors and associations to actual UI Input props', () => {
  const { controller, bindings } = fixture(); controller.setFieldError('name', 'Choose a name.');
  const field = bindings.field('name', { id: 'author-name', descriptionId: 'name-help' });
  const control = new Input(); control.props = field.inputProps;
  const html = renderToString(control.render());
  expect(html).toContain('id="author-name"'); expect(html).toContain('aria-invalid="true"'); expect(html).toContain('aria-describedby="name-help author-name-error"'); expect(html).toContain('value="Ada"'); expect(html).toContain('cs-input--error');
  expect(field.label.for).toBe('author-name'); expect(field.error.id).toBe('author-name-error'); bindings.dispose();
});
it('uses the UI Checkbox checked contract and native keyboard-capable input', () => {
  const { bindings } = fixture(); const field = bindings.field('enabled', { kind: 'checkbox' }); const checkbox = new Checkbox(); checkbox.props = { ...field.checkboxProps, label: 'Enabled' };
  const html = renderToString(checkbox.render()); expect(html).toContain('type="checkbox"'); expect(html).toContain('checked'); expect(html).toContain('id="account-enabled"'); expect(html).toContain('Enabled'); expect(field.checkboxProps.checked).toBe(true);
  expect(Object.hasOwn(field.checkboxProps, '.checked')).toBe(false); bindings.dispose();
});
it('UI Form owns controller submission but preserves explicit native attributes and validation overrides', () => {
  const { bindings } = fixture(); const form = new Form(); form.props = { bindings: bindings.form(async () => 'saved'), id: 'custom-form', method: 'post', novalidate: false };
  const html = renderToString(form.render()); expect(html).toContain('id="custom-form"'); expect(html).toContain('method="post"'); expect(html).not.toContain('novalidate'); expect(html).toContain('aria-busy="false"');
  form.props = { bindings: bindings.form(async () => 'saved') }; expect(renderToString(form.render())).toContain('novalidate'); bindings.dispose();
});
it('keeps the existing native Form path and rejects competing submit owners', () => {
  const { bindings } = fixture(); const form = new Form(); form.props = { method: 'post' }; expect(renderToString(form.render())).not.toContain('novalidate');
  form.props = { bindings: bindings.form(async () => 'saved'), submit: () => {} }; expect(() => form.render()).toThrow('either typed bindings or submit'); bindings.dispose();
});

it('preserves precise public field values and parsed submit result types', () => {
  const { bindings } = fixture();
  expectTypeOf(bindings.field('name').value).toEqualTypeOf<string>();
  expectTypeOf(bindings.field('enabled').value).toEqualTypeOf<boolean>();
  bindings.form(data => data.name.length, { onResult: result => {
    if (result.status === 'submitted') expectTypeOf(result.result).toEqualTypeOf<number>();
  } });
  if (false) {
    // @ts-expect-error Unknown UI field paths remain rejected by the public adapter.
    bindings.field('missing');
    bindings.form(data => {
      // @ts-expect-error Parsed boolean fields cannot be assigned to strings.
      const wrong: string = data.enabled;
      return wrong;
    });
  }
  bindings.dispose();
});
