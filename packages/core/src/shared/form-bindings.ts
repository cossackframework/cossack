import { FormController, type FormFieldPath, type FormFieldValue, type FormSubmitResult } from './form-controller';
import type { InputSchema, InputOf, RawInputOf } from './input-schema';

type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
export type FormControlEvent = Event & { readonly currentTarget: FormControl };
export interface FormFieldBindingOptions {
  kind?: 'text' | 'checkbox' | 'file' | 'files' | 'select-multiple';
  id?: string;
  name?: string;
  descriptionId?: string;
}
export interface FormSubmitBindingOptions<TResult> {
  focusInvalid?: boolean;
  onResult?: (result: FormSubmitResult<TResult>) => void;
}
export interface FormInputBindingAttributes {
  id: string;
  name: string;
  type?: 'checkbox' | 'file';
  multiple?: boolean;
  '.value'?: string | number;
  '.checked'?: boolean;
  'aria-invalid': boolean;
  'aria-describedby'?: string;
  '@input'?: (event: FormControlEvent) => void;
  '@change'?: (event: FormControlEvent) => void;
  '@blur': (event: FormControlEvent) => void;
}
export interface FormBindingAttributes {
  id: string;
  novalidate: true;
  'aria-busy': boolean;
  '@submit': (event: Event & { readonly currentTarget: HTMLFormElement }) => Promise<FormSubmitResult<unknown>>;
  '@reset': (event: Event) => void;
}
export interface FormFieldBinding<T extends object, P extends FormFieldPath<T>> {
  value: FormFieldValue<T, P>;
  touched: boolean;
  dirty: boolean;
  input: FormInputBindingAttributes;
  ref: { value?: FormControl };
  label: { for: string };
  error: { id: string; role: 'alert' };
  errorMessage?: string;
}
export interface FormErrorSummaryBinding {
  id: string;
  role: 'alert';
  tabindex: -1;
  message?: string;
}
const validId = (value: string) => /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(value);
const checkedValue = (value: unknown) => value === true || typeof value === 'string' && ['true', '1', 'on', 'yes'].includes(value.trim().toLowerCase());
const nativeName = (path: string) => {
  const [first, ...rest] = path.split('.');
  return first + rest.map(part => `[${part}]`).join('');
};

/** Accessible native bindings. Create once per UI owner and dispose with that owner. */
export class FormBindings<S extends InputSchema<object, object>> {
  private readonly controls = new Map<string, { element?: FormControl; kind: NonNullable<FormFieldBindingOptions['kind']>; name: string }>();
  private readonly refs = new Map<string, { value?: FormControl }>();
  private readonly unsubscribe: () => void;
  constructor(readonly controller: FormController<S>, readonly id: string) {
    if (!validId(id)) throw new TypeError('[Cossack] Form bindings require a stable HTML id.');
    this.unsubscribe = controller.subscribe(() => this.syncOwnedControls());
  }
  dispose(): void { this.unsubscribe(); this.controls.clear(); this.refs.clear(); }

  field<P extends FormFieldPath<RawInputOf<S>>>(path: P, options: FormFieldBindingOptions = {}): FormFieldBinding<RawInputOf<S>, P> {
    const state = this.controller.getField(path);
    const kind = options.kind ?? 'text';
    const id = options.id ?? `${this.id}-${path.replaceAll('.', '-')}`;
    if (!validId(id) || options.descriptionId !== undefined && !validId(options.descriptionId)) throw new TypeError('[Cossack] Form field bindings require valid HTML ids.');
    const name = options.name ?? nativeName(path);
    const entry = this.controls.get(path) ?? { kind, name };
    entry.kind = kind; entry.name = name; this.controls.set(path, entry);
    const capture = (event: FormControlEvent) => { entry.element = event.currentTarget; };
    const update = (event: FormControlEvent) => {
      capture(event);
      const control = event.currentTarget;
      let value: unknown;
      if (kind === 'checkbox') value = (control as HTMLInputElement).checked;
      else if (kind === 'file') value = (control as HTMLInputElement).files?.[0];
      else if (kind === 'files') value = Array.from((control as HTMLInputElement).files ?? []);
      else if (kind === 'select-multiple') value = Array.from((control as HTMLSelectElement).selectedOptions).map(option => option.value);
      else value = control.value;
      this.controller.setFieldValue(path, value as FormFieldValue<RawInputOf<S>, P>);
    };
    const errorId = `${id}-error`;
    const descriptions = [options.descriptionId, state.error ? errorId : undefined].filter(Boolean).join(' ');
    const input: FormInputBindingAttributes = {
      id, name, 'aria-invalid': !!state.error, ...(descriptions ? { 'aria-describedby': descriptions } : {}),
      '@blur': event => { capture(event); this.controller.markTouched(path); },
    };
    if (kind === 'checkbox') { input.type = 'checkbox'; input['.checked'] = checkedValue(state.value); input['@change'] = update; }
    else if (kind === 'file' || kind === 'files') { input.type = 'file'; input.multiple = kind === 'files'; input['@change'] = update; }
    else if (kind === 'select-multiple') { input.multiple = true; input['@change'] = update; }
    else { input['.value'] = state.value == null ? '' : typeof state.value === 'number' ? state.value : String(state.value); input['@input'] = update; }
    let ref = this.refs.get(path);
    if (!ref) {
      ref = Object.defineProperty({}, 'value', {
        get: () => entry.element,
        set: (element: FormControl | undefined) => { entry.element = element; if (element) this.syncOwnedControls(); },
        enumerable: true,
      }) as { value?: FormControl };
      this.refs.set(path, ref);
    }
    return { ...state, input, ref, label: { for: id }, error: { id: errorId, role: 'alert' as const }, errorMessage: state.error };
  }

  get summary(): FormErrorSummaryBinding { return { id: `${this.id}-errors`, role: 'alert' as const, tabindex: -1, message: this.controller.formError }; }

  form<TResult>(handler: (data: InputOf<S>) => TResult | Promise<TResult>, options: FormSubmitBindingOptions<TResult> = {}): FormBindingAttributes {
    return {
      id: this.id, novalidate: true, 'aria-busy': this.controller.isSubmitting,
      '@submit': async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const result = await this.controller.submit(handler);
        if (result.status === 'invalid' && options.focusInvalid !== false) this.focusInvalid(form);
        options.onResult?.(result);
        return result;
      },
      '@reset': () => { this.controller.reset(); },
    };
  }

  private syncOwnedControls(): void {
    for (const [path, entry] of this.controls) {
      const control = entry.element;
      if (!control) continue;
      const value = this.controller.getFieldValue(path as FormFieldPath<RawInputOf<S>>);
      if ((entry.kind === 'file' && value === undefined || entry.kind === 'files' && Array.isArray(value) && value.length === 0) && (control as HTMLInputElement).value) {
        // Browsers allow clearing a file input, never assigning a selected file.
        (control as HTMLInputElement).value = '';
      } else if (entry.kind === 'select-multiple') {
        const selected = new Set(Array.isArray(value) ? value : []);
        for (const option of Array.from((control as HTMLSelectElement).options)) option.selected = selected.has(option.value);
      }
    }
  }

  private focusInvalid(form: HTMLFormElement): void {
    const errors = this.controller.errors;
    for (const control of Array.from(form.elements)) {
      if (!('name' in control) || !('focus' in control) || typeof control.focus !== 'function' || 'disabled' in control && control.disabled) continue;
      const entry = [...this.controls.entries()].find(([, field]) => field.name === control.name);
      if (entry && errors[entry[0]]) { control.focus(); return; }
    }
    const summary = form.querySelector<HTMLElement>(`#${this.summary.id}`);
    summary?.focus();
  }
}
export function createFormBindings<S extends InputSchema<object, object>>(controller: FormController<S>, options: { id: string }): FormBindings<S> {
  return new FormBindings(controller, options.id);
}
