import { isActionValidationError } from './errors';
import type { InputSchema, InputOf, RawInputOf } from './input-schema';
import { RpcError } from './rpc-stream';
import type { DeepKeysOf } from './validation';

export type FormFieldPath<T extends object> = Extract<DeepKeysOf<T>, string>;

export type FormFieldValue<T extends object, P extends FormFieldPath<T>> =
  P extends `${infer Key}.${infer Rest}`
    ? Key extends keyof T ? FormFieldValue<Extract<T[Key], object>, Extract<Rest, FormFieldPath<Extract<T[Key], object>>>> : never
    : P extends keyof T ? T[P] : never;

export type FormValidationResult<S extends InputSchema<object, object>> =
  | { valid: true; stale: false; data: InputOf<S> }
  | { valid: false; stale: false }
  | { valid: false; stale: true };

export type FormSubmitResult<TResult> =
  | { status: 'submitted'; result: TResult }
  | { status: 'invalid' }
  | { status: 'stale' }
  | { status: 'busy' };

type ErrorBag<T extends object> = Partial<Record<FormFieldPath<T>, string>> & Record<string, string | undefined>;

const forbiddenPathKeys = new Set(['__proto__', 'prototype', 'constructor']);
const safePathPart = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function cloneValue<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (typeof File !== 'undefined' && value instanceof File || typeof Blob !== 'undefined' && value instanceof Blob) return value;
  if (seen.has(value)) return seen.get(value) as T;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(cloneValue(item, seen));
    return copy as T;
  }
  if (!isPlainObject(value)) return value;
  const copy = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>;
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || forbiddenPathKeys.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) throw new TypeError('[Cossack] Form values cannot contain accessors.');
    Object.defineProperty(copy, key, { value: cloneValue(descriptor.value, seen), enumerable: true, writable: true, configurable: true });
  }
  return copy as T;
}

function sameValue(left: unknown, right: unknown, seen = new WeakMap<object, object>()): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (seen.get(left) === right) return true;
  seen.set(left, right);
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index], seen));
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left), rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every(key =>
    Object.hasOwn(right, key) && sameValue(left[key], right[key], seen));
}

function assertSafePath(path: string): string[] {
  const parts = path.split('.');
  if (!path || parts.some(part => !safePathPart.test(part) || forbiddenPathKeys.has(part))) {
    throw new TypeError('[Cossack] Invalid form field path.');
  }
  return parts;
}

function getAtPath(root: unknown, parts: string[]): unknown {
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    if (!current || typeof current !== 'object' || Array.isArray(current) && index < parts.length) return undefined;
    if (!Object.hasOwn(current, parts[index])) return undefined;
    current = (current as Record<string, unknown>)[parts[index]];
  }
  return current;
}

function setAtPath(root: unknown, parts: string[], value: unknown): void {
  let current = root;
  for (let index = 0; index < parts.length - 1; index++) {
    if (!isPlainObject(current)) throw new TypeError('[Cossack] Form field path does not point to an object.');
    const key = parts[index];
    let child = current[key];
    if (child === undefined || child === null) current[key] = child = Object.create(null);
    if (!isPlainObject(child)) throw new TypeError('[Cossack] Form field path does not point to an object.');
    current = child;
  }
  if (!isPlainObject(current)) throw new TypeError('[Cossack] Form field path does not point to an object.');
  current[parts[parts.length - 1]] = value;
}

function flattenServerErrors(input: unknown): Record<string, string> | undefined {
  if (!isPlainObject(input)) return undefined;
  const errors: Record<string, string> = Object.create(null);
  const visit = (value: unknown, path: string[]) => {
    if (typeof value === 'string') {
      errors[path.join('.') || ''] = value;
      return;
    }
    if (!isPlainObject(value)) return;
    for (const key of Object.keys(value)) {
      if (key === '_') {
        if (typeof value[key] === 'string') errors[path.join('.') || ''] = value[key] as string;
      } else if (safePathPart.test(key) && !forbiddenPathKeys.has(key)) {
        visit(value[key], [...path, key]);
      }
    }
  };
  visit(input, []);
  return errors;
}

function fieldErrorsFrom(error: unknown): unknown {
  if (isActionValidationError(error)) return error.fieldErrors;
  if (error instanceof RpcError && error.code === 'COSSACK_VALIDATION_FAILED') return error.fieldErrors;
  if (error instanceof Error) {
    const rpc = error as Error & { code?: unknown; fieldErrors?: unknown };
    if (rpc.code === 'COSSACK_VALIDATION_FAILED' && isPlainObject(rpc.fieldErrors)) return rpc.fieldErrors;
  }
  return undefined;
}

/** A typed, DOM-free form state owner that uses the shared input schema. */
export class FormController<S extends InputSchema<object, object>> {
  private initial: RawInputOf<S>;
  private current: RawInputOf<S>;
  private errorState: Record<string, string> = Object.create(null);
  private touchedState = new Set<string>();
  private revision = 0;
  private validationController?: AbortController;
  private submittingState = false;
  private submittedState = false;

  constructor(private readonly schema: S, initialValues: RawInputOf<S>) {
    this.initial = cloneValue(initialValues);
    this.current = cloneValue(initialValues);
  }

  get values(): RawInputOf<S> { return cloneValue(this.current); }
  get initialValues(): RawInputOf<S> { return cloneValue(this.initial); }
  get errors(): Readonly<ErrorBag<RawInputOf<S>>> {
    const copy = Object.assign(Object.create(null), this.errorState) as ErrorBag<RawInputOf<S>>;
    delete copy[''];
    return copy;
  }
  get touched(): ReadonlySet<FormFieldPath<RawInputOf<S>>> {
    return new Set(this.touchedState) as Set<FormFieldPath<RawInputOf<S>>>;
  }
  get formError(): string | undefined { return this.errorState['']; }
  get isDirty(): boolean { return !sameValue(this.initial, this.current); }
  get isSubmitting(): boolean { return this.submittingState; }
  get isSubmitted(): boolean { return this.submittedState; }

  getFieldValue<P extends FormFieldPath<RawInputOf<S>>>(path: P): FormFieldValue<RawInputOf<S>, P> {
    return cloneValue(getAtPath(this.current, assertSafePath(path))) as FormFieldValue<RawInputOf<S>, P>;
  }

  getField<P extends FormFieldPath<RawInputOf<S>>>(path: P) {
    return {
      value: this.getFieldValue(path),
      error: this.fieldError(path),
      touched: this.touchedState.has(path),
      dirty: !sameValue(getAtPath(this.initial, assertSafePath(path)), getAtPath(this.current, assertSafePath(path))),
    };
  }

  setFieldValue<P extends FormFieldPath<RawInputOf<S>>>(path: P, value: FormFieldValue<RawInputOf<S>, P>): void {
    const parts = assertSafePath(path);
    const next = cloneValue(this.current);
    setAtPath(next, parts, cloneValue(value));
    if (sameValue(this.current, next)) return;
    this.current = next;
    this.changed(path);
  }

  setValues(values: RawInputOf<S>): void {
    this.current = cloneValue(values);
    this.changed();
  }

  markTouched<P extends FormFieldPath<RawInputOf<S>>>(path: P): void {
    assertSafePath(path);
    this.touchedState.add(path);
  }

  fieldError<P extends FormFieldPath<RawInputOf<S>>>(path: P): string | undefined {
    return this.errorState[path];
  }

  setFieldError<P extends FormFieldPath<RawInputOf<S>>>(path: P, message: string): void {
    assertSafePath(path);
    this.errorState[path] = message;
  }

  setFormError(message: string): void { this.errorState[''] = message; }

  clearErrors<P extends FormFieldPath<RawInputOf<S>>>(path?: P): void {
    if (path === undefined) {
      this.errorState = Object.create(null);
      return;
    }
    const prefix = `${path}.`;
    for (const key of Object.keys(this.errorState)) {
      if (key === path || key.startsWith(prefix)) delete this.errorState[key];
    }
  }

  /** Copy nested schema/RPC field errors into the form's dot-path error map. */
  applyServerError(error: unknown): boolean {
    const fieldErrors = fieldErrorsFrom(error);
    const flattened = flattenServerErrors(fieldErrors);
    if (!flattened) return false;
    if (!Object.keys(flattened).length && error instanceof Error) flattened[''] = error.message;
    this.errorState = flattened;
    return true;
  }

  async validate(): Promise<FormValidationResult<S>> {
    this.validationController?.abort();
    const controller = new AbortController();
    this.validationController = controller;
    const revision = this.revision;
    try {
      const data = await this.schema.parse(cloneValue(this.current), { signal: controller.signal });
      if (revision !== this.revision) return { valid: false, stale: true };
      this.errorState = Object.create(null);
      // S retains the concrete parse result, but TypeScript resolves the method
      // through its object constraint inside this generic class.
      return { valid: true, stale: false, data: data as InputOf<S> };
    } catch (error) {
      if (revision !== this.revision || controller.signal.aborted) return { valid: false, stale: true };
      const flattened = flattenServerErrors(fieldErrorsFrom(error));
      if (flattened) {
        this.errorState = flattened;
        return { valid: false, stale: false };
      }
      throw error;
    } finally {
      if (this.validationController === controller) this.validationController = undefined;
    }
  }

  async submit<TResult>(handler: (data: InputOf<S>) => TResult | Promise<TResult>): Promise<FormSubmitResult<TResult>> {
    if (this.submittingState) return { status: 'busy' };
    this.submittingState = true;
    this.submittedState = false;
    const revision = this.revision;
    try {
      const validation = await this.validate();
      if (validation.stale || revision !== this.revision) return { status: 'stale' };
      if (!validation.valid) return { status: 'invalid' };
      try {
        const result = await handler(validation.data);
        if (revision !== this.revision) return { status: 'stale' };
        this.submittedState = true;
        return { status: 'submitted', result };
      } catch (error) {
        if (revision !== this.revision) return { status: 'stale' };
        if (this.applyServerError(error)) return { status: 'invalid' };
        throw error;
      }
    } finally {
      this.submittingState = false;
    }
  }

  reset(initialValues?: RawInputOf<S>): void {
    if (initialValues !== undefined) this.initial = cloneValue(initialValues);
    this.current = cloneValue(this.initial);
    this.errorState = Object.create(null);
    this.touchedState.clear();
    this.submittedState = false;
    this.changed();
  }

  private changed(path?: string): void {
    this.revision++;
    this.validationController?.abort();
    this.validationController = undefined;
    this.submittedState = false;
    if (path === undefined) this.errorState = Object.create(null);
    else this.clearErrors(path as FormFieldPath<RawInputOf<S>>);
  }
}

export function createFormController<S extends InputSchema<object, object>>(
  schema: S,
  initialValues: RawInputOf<S>,
): FormController<S> {
  return new FormController(schema, initialValues);
}
