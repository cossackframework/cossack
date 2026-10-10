// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createFormController } from '../src/shared/form-controller';
import { createFormBindings } from '../src/shared/form-bindings';
import { input } from '../src/shared/input-schema';
const schema = input.object({ profile: input.object({ name: input.string({ required: true }) }), enabled: input.boolean({ coerce: true }), attachment: input.file().optional(), items: input.array(input.object({ name: input.string({ required: true }) })) });
function fixture() {
  const controller = createFormController(schema, { profile: { name: 'Ada' }, enabled: 'off', attachment: undefined, items: [{ name: 'One' }] });
  return { controller, bindings: createFormBindings(controller, { id: 'profile' }) };
}
describe('accessible native form bindings', () => {
  it('associates stable field labels/descriptions and field errors', () => {
    const { controller, bindings } = fixture(); controller.setFieldError('profile.name', 'Choose a name.');
    const field = bindings.field('profile.name', { id: 'author-name', descriptionId: 'name-help', name: 'author' });
    expect(field.label).toEqual({ for: 'author-name' }); expect(field.error).toEqual({ id: 'author-name-error', role: 'alert' });
    expect(field.input).toMatchObject({ id: 'author-name', name: 'author', '.value': 'Ada', 'aria-invalid': true, 'aria-describedby': 'name-help author-name-error' });
    expect(field.errorMessage).toBe('Choose a name.'); bindings.dispose();
  });
  it('captures typed array paths, checkbox values and blur touch state', () => {
    const { controller, bindings } = fixture(); const name = document.createElement('input'); name.value = 'Two';
    const field = bindings.field('items.0.name'); expect(field.input.name).toBe('items[0][name]');
    field.input['@input']!({ currentTarget: name } as any); field.input['@blur']({ currentTarget: name } as any);
    expect(controller.getField('items.0.name')).toMatchObject({ value: 'Two', touched: true, dirty: true });
    const checkbox = document.createElement('input'); checkbox.checked = true;
    const enabled = bindings.field('enabled', { kind: 'checkbox' }); expect(enabled.input['.checked']).toBe(false);
    enabled.input['@change']!({ currentTarget: checkbox } as any); expect(controller.getFieldValue('enabled')).toBe(true); bindings.dispose();
  });
  it('preserves selected files and clears their owned native control on reset', () => {
    const { controller, bindings } = fixture(); const control = document.createElement('input'); control.type = 'file';
    const file = new File(['actual bytes'], 'report.txt'); Object.defineProperty(control, 'files', { configurable: true, value: [file] });
    let selectedName = 'fakepath/report.txt'; Object.defineProperty(control, 'value', { configurable: true, get: () => selectedName, set: value => { selectedName = value; } });
    const field = bindings.field('attachment', { kind: 'file' }); expect(field.input).not.toHaveProperty('.value');
    field.input['@change']!({ currentTarget: control } as any); expect(controller.values.attachment).toBe(file);
    controller.reset(); expect(controller.values.attachment).toBeUndefined(); expect(control.value).toBe(''); bindings.dispose();
  });
  it('focuses first invalid named control in DOM order and prevents native submission', async () => {
    const { controller, bindings } = fixture(); controller.setFieldValue('profile.name', ''); controller.setFieldValue('items.0.name', '');
    const form = document.createElement('form'); form.innerHTML = '<input name="items[0][name]"><input name="profile[name]">'; document.body.appendChild(form);
    bindings.field('profile.name'); bindings.field('items.0.name'); const preventDefault = vi.fn(); const submit = vi.fn();
    const result = await bindings.form(submit)['@submit']({ currentTarget: form, preventDefault } as any);
    expect(result).toEqual({ status: 'invalid' }); expect(preventDefault).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(form.elements[0]); form.remove(); bindings.dispose();
  });
  it('focuses a form error summary and supports explicit focus suppression', async () => {
    const { controller, bindings } = fixture(); const form = document.createElement('form'); const summary = document.createElement('p'); summary.id = bindings.summary.id; summary.tabIndex = -1; form.appendChild(summary); document.body.appendChild(form);
    const handler = async () => { throw { validationCode: 'COSSACK_VALIDATION_FAILED', fieldErrors: { _: 'Review this form.' } }; };
    const focused = vi.spyOn(summary, 'focus');
    const result = await bindings.form(handler)['@submit']({ currentTarget: form, preventDefault() {} } as any); expect(result).toEqual({status: 'invalid'}); expect(controller.formError).toBe('Review this form.'); expect(form.ownerDocument.getElementById(summary.id)).toBe(summary); expect(focused).toHaveBeenCalledOnce(); expect(controller.formError).toBe('Review this form.');
    focused.mockClear(); await bindings.form(handler, { focusInvalid: false })['@submit']({ currentTarget: form, preventDefault() {} } as any); expect(focused).not.toHaveBeenCalled();
    form.remove(); bindings.dispose();
  });
  it('synchronizes multiple select controls through owned refs and releases subscriptions', () => {
    const controller = createFormController(input.object({ tags: input.array(input.string()) }), { tags: ['one'] }); const bindings = createFormBindings(controller, { id: 'tags' });
    const select = document.createElement('select'); select.multiple = true; select.innerHTML = '<option value="one">One</option><option value="two">Two</option>';
    const field = bindings.field('tags', { kind: 'select-multiple' }); field.ref.value = select;
    expect(select.options[0].selected).toBe(true); expect(select.options[1].selected).toBe(false);
    select.options[1].selected = true; field.input['@change']!({ currentTarget: select } as any); expect(controller.values.tags).toEqual(['one', 'two']);
    controller.reset(); expect(select.options[1].selected).toBe(false); bindings.dispose(); controller.setFieldValue('tags', ['two']); expect(select.options[0].selected).toBe(true);
  });
});

it('numeric array paths retain types, reject unsafe indices and map item validation errors', async () => {
  const { controller } = fixture();
  if (false) {
    // @ts-expect-error Unknown fields of an indexed array item are rejected.
    controller.getFieldValue('items.0.missing');
    // @ts-expect-error Indexed item values keep their string type.
    controller.setFieldValue('items.0.name', false);
  }
  controller.setFieldValue('items.0.name', ''); await controller.validate();
  expect(controller.fieldError('items.0.name')).toBe('This field is required');
  expect(controller.applyServerError({ validationCode: 'COSSACK_VALIDATION_FAILED', fieldErrors: { items: { '0': { name: 'Taken' } } } })).toBe(true);
  expect(controller.fieldError('items.0.name')).toBe('Taken');
  for (const path of ['items.-1.name', 'items.01.name', 'items.999999.name', 'items.0.__proto__', 'items.2.name']) expect(() => controller.setFieldValue(path as any, 'Unsafe')).toThrow();
  controller.setFieldValue('items.1.name', 'Appended'); expect(controller.values.items).toEqual([{ name: '' }, { name: 'Appended' }]);
});
it('subscribers observe complete submit/reset state and unsubscribe idempotently', async () => {
  const { controller } = fixture(); const states: { submitting: boolean; submitted: boolean; dirty: boolean }[] = [];
  const unsubscribe = controller.subscribe(() => states.push({ submitting: controller.isSubmitting, submitted: controller.isSubmitted, dirty: controller.isDirty }));
  controller.setFieldValue('profile.name', 'Grace'); await controller.submit(async () => 'Saved'); controller.reset();
  expect(states).toContainEqual({ submitting: true, submitted: false, dirty: true });
  expect(states).toContainEqual({ submitting: false, submitted: true, dirty: true });
  expect(states.at(-1)).toEqual({ submitting: false, submitted: false, dirty: false });
  unsubscribe(); unsubscribe(); const count = states.length; controller.markTouched('profile.name'); expect(states).toHaveLength(count);
});
