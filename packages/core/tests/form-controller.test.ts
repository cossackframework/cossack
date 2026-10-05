import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createFormController } from '../src/shared/form-controller';
import { input } from '../src/shared/input-schema';
import { RpcError } from '../src/shared/rpc-stream';

const formSchema = input.object({
  name: input.string({ required: true }),
  profile: input.object({ age: input.number({ coerce: true, min: 18 }) }),
  enabled: input.boolean({ coerce: true }),
  tags: input.array(input.string(), { minItems: 1 }),
});

function form() {
  return createFormController(formSchema, {
    name: 'Ada', profile: { age: '21' }, enabled: 'on', tags: ['typescript'],
  });
}

describe('createFormController', () => {
  afterEach(() => vi.restoreAllMocks());

  it('infers nested paths, raw field values, and parsed submit values', async () => {
    const controller = form();
    expectTypeOf(controller.getFieldValue('profile.age')).toEqualTypeOf<string | number>();
    expectTypeOf(controller.getFieldValue('tags')).toEqualTypeOf<string[]>();
    if (false) {
      // @ts-expect-error Unknown nested fields are rejected.
      controller.getFieldValue('profile.missing');
      // @ts-expect-error A boolean cannot be assigned to the name field.
      controller.setFieldValue('name', false);
    }

    const result = await controller.validate();
    if (result.valid) {
      expectTypeOf(result.data.profile.age).toEqualTypeOf<number>();
      expectTypeOf(result.data.enabled).toEqualTypeOf<boolean>();
    }
    expect(result).toEqual({ valid: true, stale: false,
      data: { name: 'Ada', profile: { age: 21 }, enabled: true, tags: ['typescript'] } });
    expect(controller.getFieldValue('profile.age')).toBe('21');
    expect(controller.errors).toEqual({});
  });

  it('tracks nested dirty/touched fields and resets all form state', () => {
    const controller = form();
    controller.markTouched('profile.age');
    controller.setFieldError('profile.age', 'Use an adult age.');
    controller.setFieldValue('profile.age', '17');
    expect(controller.getField('profile.age')).toEqual({ value: '17', error: undefined, touched: true, dirty: true });
    expect(controller.isDirty).toBe(true);

    controller.reset();
    expect(controller.values).toEqual({ name: 'Ada', profile: { age: '21' }, enabled: 'on', tags: ['typescript'] });
    expect(controller.isDirty).toBe(false);
    expect(controller.touched.size).toBe(0);
    expect(controller.errors).toEqual({});
    expect(controller.formError).toBeUndefined();
    expect(controller.isSubmitted).toBe(false);
  });

  it('flattens schema field errors and clears only the edited path', async () => {
    const controller = form();
    controller.setFieldValue('name', '');
    controller.setFieldValue('profile.age', 'bad');
    const result = await controller.validate();
    expect(result).toEqual({ valid: false, stale: false });
    expect(controller.fieldError('name')).toBe('This field is required');
    expect(controller.fieldError('profile.age')).toBe('Expected a finite number.');

    controller.setFieldValue('name', 'Grace');
    expect(controller.fieldError('name')).toBeUndefined();
    expect(controller.fieldError('profile.age')).toBe('Expected a finite number.');
  });

  it('recognizes validation errors created by a duplicate Core module copy', () => {
    const controller = form();
    expect(controller.applyServerError({
      validationCode: 'COSSACK_VALIDATION_FAILED',
      fieldErrors: { profile: { age: 'Choose a valid age.' } },
    })).toBe(true);
    expect(controller.fieldError('profile.age')).toBe('Choose a valid age.');
  });

  it('ignores a validation result after a later field edit', async () => {
    let begin!: () => void;
    let finish!: () => void;
    const started = new Promise<void>(resolve => { begin = resolve; });
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const schema = input.object({
      title: input.string().refine(async () => { begin(); await pending; return false; }, 'Title rejected.'),
    });
    const controller = createFormController(schema, { title: 'first' });
    const validation = controller.validate();
    await started;
    controller.setFieldValue('title', 'second');
    finish();
    expect(await validation).toEqual({ valid: false, stale: true });
    expect(controller.fieldError('title')).toBeUndefined();
  });

  it('maps RPC field errors without caller translation and blocks duplicate submits', async () => {
    const controller = form();
    let begin!: () => void;
    let finish!: () => void;
    const started = new Promise<void>(resolve => { begin = resolve; });
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const handler = vi.fn(async () => { begin(); await pending; return 'saved'; });
    const first = controller.submit(handler);
    await started;
    expect(await controller.submit(handler)).toEqual({ status: 'busy' });
    finish();
    expect(await first).toEqual({ status: 'submitted', result: 'saved' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(controller.isSubmitted).toBe(true);

    const invalid = await controller.submit(async () => {
      throw new RpcError('COSSACK_VALIDATION_FAILED', 'Fix the highlighted fields.', {
        fieldErrors: { profile: { age: 'Must be at least 18.' }, _: 'Review the form.' },
      });
    });
    expect(invalid).toEqual({ status: 'invalid' });
    expect(controller.fieldError('profile.age')).toBe('Must be at least 18.');
    expect(controller.formError).toBe('Review the form.');
    expect(controller.isSubmitted).toBe(false);
  });

  it('does not apply a server error after the submitted values change', async () => {
    const controller = form();
    let begin!: () => void;
    let reject!: () => void;
    const started = new Promise<void>(resolve => { begin = resolve; });
    const pending = new Promise<never>((_resolve, rejectPromise) => { reject = () => rejectPromise(new RpcError(
      'COSSACK_VALIDATION_FAILED', 'Old result.', { fieldErrors: { name: 'Name is taken.' } },
    )); });
    const submission = controller.submit(async () => { begin(); return pending; });
    await started;
    controller.setFieldValue('name', 'New name');
    reject();
    expect(await submission).toEqual({ status: 'stale' });
    expect(controller.fieldError('name')).toBeUndefined();
  });

  it('reports a stale status when values change before a successful submit settles', async () => {
    const controller = form();
    let begin!: () => void;
    let finish!: () => void;
    const started = new Promise<void>(resolve => { begin = resolve; });
    const pending = new Promise<string>(resolve => { finish = () => resolve('saved'); });
    const submission = controller.submit(async () => { begin(); return pending; });
    await started;
    controller.setFieldValue('name', 'Grace');
    finish();
    expect(await submission).toEqual({ status: 'stale' });
    expect(controller.isSubmitted).toBe(false);
  });

  it('keeps File values by identity when callers read or reset form data', () => {
    expect(typeof File).toBe('function');
    const schema = input.object({ attachment: input.file(), attachments: input.array(input.file()) });
    const attachment = new File(['one'], 'one.txt');
    const another = new File(['two'], 'two.txt');
    const controller = createFormController(schema, { attachment, attachments: [another] });
    expect(controller.values.attachment).toBe(attachment);
    expect(controller.values.attachments[0]).toBe(another);
    controller.reset();
    expect(controller.values.attachment).toBe(attachment);
    expect(controller.values.attachments[0]).toBe(another);
  });
});
