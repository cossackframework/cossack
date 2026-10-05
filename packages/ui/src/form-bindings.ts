import { createFormBindings, type FormController, type FormBindings, type FormFieldBinding, type FormErrorSummaryBinding, type FormFieldPath, type FormFieldBindingOptions, type InputSchema, type RawInputOf } from '@cossackframework/core';
import type { InputProps } from './components/Input';
import type { CheckboxProps } from './components/Checkbox';

export interface UiFormFieldBinding<T extends object, P extends FormFieldPath<T>> extends FormFieldBinding<T, P> {
  inputProps: InputProps;
  checkboxProps: CheckboxProps;
}
export interface UiFormBindings<S extends InputSchema<object, object>> {
  native: FormBindings<S>;
  form: FormBindings<S>['form'];
  dispose(): void;
  readonly summary: FormErrorSummaryBinding;
  field<P extends FormFieldPath<RawInputOf<S>>>(path: P, options?: FormFieldBindingOptions): UiFormFieldBinding<RawInputOf<S>, P>;
}

/** UI control adapters share the native controller, labels and error identities. */
export function createUiFormBindings<S extends InputSchema<object, object>>(controller: FormController<S>, options: { id: string }): UiFormBindings<S> {
  const native = createFormBindings(controller, options);
  return {
    native,
    form: native.form.bind(native),
    dispose: native.dispose.bind(native),
    get summary() { return native.summary; },
    field<P extends FormFieldPath<RawInputOf<S>>>(path: P, options: FormFieldBindingOptions = {}): UiFormFieldBinding<RawInputOf<S>, P> {
      const field = native.field(path, options);
      const inputProps: InputProps = { ...field.input, variant: field.errorMessage ? 'error' : 'default' };
      const { '.checked': checked, type: _type, multiple: _multiple, ...attributes } = field.input;
      const checkboxProps: CheckboxProps = { ...attributes, checked: checked ?? false };
      return { ...field, inputProps, checkboxProps };
    },
  };
}
