// src/shared/validation.ts

import { resolveStatePath } from './store';

/**
 * Validation rule options for the @Validate decorator
 */
export interface ValidationRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  email?: boolean;
  url?: boolean;
  custom?: (value: any) => boolean;
  customAsync?: (value: any, component?: any) => Promise<boolean>;
  message?: string;
}

// ============================================================================
// Type-safe store rules
// ============================================================================
// `storeRules<T>()` lets you write validation rules for a @Store property with
// compile-time checking of the (relative) field paths against the store type T.
//
//   @Store()
//   @Validate({
//     rules: storeRules<SubmissionState>({
//       email: { required: true, email: true, message: '...' },
//       'address.zip': { required: true, pattern: /^\d{5}$/ },
//       tags: { required: true, minLength: 1 },
//     }),
//   })
//   submission: SubmissionState = { email: '', address: { zip: '' }, tags: [] };
//
// Keys are RELATIVE to the store ('email', 'address.zip') and are auto-prefixed
// by @Validate to the full runtime paths ('submission.email',
// 'submission.address.zip'). Passing <T> is optional — omit it for an untyped
// Record<string, ValidationRule>.

/**
 * Built-in non-plain object types that should NOT be recursed into when
 * deriving validation paths (their own methods/properties are not user state).
 * Such values are validated as a whole (e.g. via a `custom` rule).
 */
type NonRecurableObject =
  | Date
  | RegExp
  | Map<unknown, unknown>
  | Set<unknown>
  | Promise<unknown>
  | File
  | Blob
  | ArrayBuffer
  | DataView
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

/**
 * Recursively build the union of dotted paths into a plain-object type T.
 *
 * - For an object T, yields each string key plus, for keys whose value is
 *   itself a plain object, `'key' + '.' + DeepKeysOf<value>`.
 * - For array values, yields only the top-level key (arrays are validated as a
 *   whole via minLength/maxLength; elements are not addressable).
 * - For built-in non-plain objects (Date, RegExp, Map, Set, typed arrays,
 *   etc.), yields only the top-level key — they are validated as a whole.
 * - For primitives, yields the key only (no recursion).
 * - Yields `never` for non-object types so the recursion terminates.
 */
export type DeepKeysOf<T> = T extends object
  ? T extends (infer _U)[]
    ? never // array elements are not addressable; use the array key directly
    : T extends NonRecurableObject
      ? never // built-in non-plain objects are validated as a whole
      : {
          [K in keyof T & string]: T[K] extends object
            ? T[K] extends (infer _U)[]
              ? K // array value: validate the array as a whole
              : T[K] extends NonRecurableObject
                ? K // built-in non-plain object value: validate as a whole
                : K | `${K}.${DeepKeysOf<T[K]>}`
            : K;
        }[keyof T & string]
  : never;

/**
 * A rule map whose keys are relative dotted paths into the store type T.
 * Use `keyof T` (top-level only) when you don't want deep paths typed.
 */
export type StoreRuleMap<T = any> = Partial<Record<DeepKeysOf<T>, ValidationRule>>;

/**
 * Identity helper that type-checks a map of RELATIVE store field paths against
 * the store type `T`. Returns the map unchanged at runtime; the type parameter
 * is purely for compile-time validation.
 *
 * Omit `<T>` to get an untyped `Record<string, ValidationRule>` (no path
 * checking, but still usable with @Validate on a @Store).
 *
 * The keys you write are relative to the store ('email', 'address.zip'); the
 * `@Validate` decorator auto-prefixes them with the decorated property name to
 * produce the full runtime paths ('submission.email').
 *
 * @example
 * ```ts
 * interface Form { email: string; address: { zip: string }; tags: string[] }
 *
 * @Store()
 * @Validate({ rules: storeRules<Form>({
 *   email: { required: true, email: true },
 *   'address.zip': { required: true, pattern: /^\d{5}$/ },
 *   tags: { required: true, minLength: 1 },
 * }) })
 * form: Form = { email: '', address: { zip: '' }, tags: [] };
 * ```
 */
export function storeRules<T = any>(
    rules: StoreRuleMap<T>,
): StoreRuleMap<T> {
    return rules;
}


/**
 * Configuration options for validation behavior
 */
export interface ValidationConfig {
  trigger?: 'input' | 'blur' | 'submit' | 'all';
  runOn?: 'client' | 'server' | 'both';
  errorProperty?: string;
  debounce?: number;
}

/**
 * Combined validation options
 */
export interface ValidateOptions {
  rules?: ValidationRule;
  config?: ValidationConfig;
}

/**
 * Result of a validation check
 */
export interface ValidationResult {
  valid: boolean;
  message?: string;
}

/**
 * Store for validation rules per property
 */
export interface ValidationRulesStore {
  [propertyName: string]: {
    rules: ValidationRule;
    config: ValidationConfig;
  };
}

/**
 * Email regex pattern
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * URL regex pattern
 */
const URL_REGEX = /^https?:\/\/.+/;

/**
 * Built-in validators
 */
const validators = {
  required: (value: any): boolean => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  },

  minLength: (value: any, minLength: number): boolean => {
    if (typeof value === 'string') return value.length >= minLength;
    if (Array.isArray(value)) return value.length >= minLength;
    return false;
  },

  maxLength: (value: any, maxLength: number): boolean => {
    if (typeof value === 'string') return value.length <= maxLength;
    if (Array.isArray(value)) return value.length <= maxLength;
    return false;
  },

  min: (value: any, min: number): boolean => {
    const num = Number(value);
    return !isNaN(num) && num >= min;
  },

  max: (value: any, max: number): boolean => {
    const num = Number(value);
    return !isNaN(num) && num <= max;
  },

  pattern: (value: any, pattern: RegExp): boolean => {
    if (typeof value !== 'string') return false;
    return pattern.test(value);
  },

  email: (value: any): boolean => {
    if (typeof value !== 'string') return false;
    return EMAIL_REGEX.test(value);
  },

  url: (value: any): boolean => {
    if (typeof value !== 'string') return false;
    return URL_REGEX.test(value);
  },
};

/**
 * Get default error message for a validation rule
 */
function getDefaultMessage(rule: ValidationRule, ruleName: string): string {
  switch (ruleName) {
    case 'required':
      return 'This field is required';
    case 'minLength':
      return `Minimum length is ${rule.minLength} characters`;
    case 'maxLength':
      return `Maximum length is ${rule.maxLength} characters`;
    case 'min':
      return `Minimum value is ${rule.min}`;
    case 'max':
      return `Maximum value is ${rule.max}`;
    case 'pattern':
      return 'Invalid format';
    case 'email':
      return 'Please enter a valid email address';
    case 'url':
      return 'Please enter a valid URL';
    case 'custom':
      return 'Invalid value';
    case 'customAsync':
      return 'Validation failed';
    default:
      return 'Invalid value';
  }
}

/**
 * Validate a value against a set of rules (synchronous)
 */
export function validateValue(value: any, rules: ValidationRule): ValidationResult {
  // Check required first
  if (rules.required) {
    if (!validators.required(value)) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'required'),
      };
    }
  }

  // Skip other validations if value is empty and not required
  if (value === null || value === undefined || value === '') {
    return { valid: true };
  }

  // minLength
  if (rules.minLength !== undefined) {
    if (!validators.minLength(value, rules.minLength)) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'minLength'),
      };
    }
  }

  // maxLength
  if (rules.maxLength !== undefined) {
    if (!validators.maxLength(value, rules.maxLength)) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'maxLength'),
      };
    }
  }

  // min
  if (rules.min !== undefined) {
    if (!validators.min(value, rules.min)) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'min'),
      };
    }
  }

  // max
  if (rules.max !== undefined) {
    if (!validators.max(value, rules.max)) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'max'),
      };
    }
  }

  // pattern
  if (rules.pattern) {
    if (!validators.pattern(value, rules.pattern)) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'pattern'),
      };
    }
  }

  // email
  if (rules.email) {
    if (!validators.email(value)) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'email'),
      };
    }
  }

  // url
  if (rules.url) {
    if (!validators.url(value)) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'url'),
      };
    }
  }

  // custom sync validator
  if (rules.custom) {
    try {
      if (!rules.custom(value)) {
        return {
          valid: false,
          message: rules.message || getDefaultMessage(rules, 'custom'),
        };
      }
    } catch (e) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'custom'),
      };
    }
  }

  return { valid: true };
}

/**
 * Validate a value against a set of rules (asynchronous, includes customAsync)
 */
export async function validateValueAsync(
  value: any,
  rules: ValidationRule,
  component?: any
): Promise<ValidationResult> {
  // First run sync validations
  const syncResult = validateValue(value, rules);
  if (!syncResult.valid) {
    return syncResult;
  }

  // Check customAsync
  if (rules.customAsync) {
    try {
      // Pass component as second argument for access to component methods
      const isValid = await rules.customAsync(value, component);
      if (!isValid) {
        return {
          valid: false,
          message: rules.message || getDefaultMessage(rules, 'customAsync'),
        };
      }
    } catch (e) {
      return {
        valid: false,
        message: rules.message || getDefaultMessage(rules, 'customAsync'),
      };
    }
  }

  return { valid: true };
}

/**
 * Get validation rules from a component class
 */
export function getValidationRules(target: any): ValidationRulesStore {
  return Reflect.getMetadata('cossack:validation', target.constructor) || {};
}

/**
 * Set validation rules on a component class
 */
export function setValidationRules(
  target: any,
  rules: ValidationRulesStore
): void {
  Reflect.defineMetadata('cossack:validation', rules, target.constructor);
}

// ========== Component validation helpers ==========
// These functions are extracted from the Cossack class body and accept the
// component instance as the first argument. They use the component's public
// getProperty/setProperty helpers and requestUpdate to remain UI-agnostic.

/** Get the error property name from validation config. */
export function getValidationErrorProperty(component: any): string {
    const rules = getValidationRules(component);
    const firstRule = Object.values(rules)[0];
    return firstRule?.config?.errorProperty || 'errors';
}

/** Get the error message for a specific property. */
export function getError(component: any, propertyName: string): string | undefined {
    const errorProperty = getValidationErrorProperty(component);
    const errors = component.getProperty(errorProperty) as Record<string, string> | undefined;
    return errors?.[propertyName];
}

/** Check if a property has validation errors. */
export function hasError(component: any, propertyName: string): boolean {
    const error = getError(component, propertyName);
    return error !== undefined && error !== '';
}

/** Set validation error for a specific property. */
export function setValidationError(component: any, propertyName: string, message: string): void {
    const errorProperty = getValidationErrorProperty(component);
    const errors = component.getProperty(errorProperty) as Record<string, string> || {};
    errors[propertyName] = message;
    component.setProperty(errorProperty, { ...errors });
    if (!component.isServer) {
        component.requestUpdate();
    }
}

/** Clear validation error for a specific property. */
export function clearValidationError(component: any, propertyName: string): void {
    const errorProperty = getValidationErrorProperty(component);
    const errors = component.getProperty(errorProperty) as Record<string, string> || {};
    if (errors[propertyName]) {
        delete errors[propertyName];
        component.setProperty(errorProperty, { ...errors });
        if (!component.isServer) {
            component.requestUpdate();
        }
    }
}

/**
 * Tracks the latest validation request ID per property per component instance.
 * Used to discard stale async validation results when a newer validation for
 * the same property has started before the previous one finished.
 */
const validationRequestIds = new WeakMap<any, Record<string, number>>();

function getLatestRequestId(component: any, propertyName: string): number {
    const ids = validationRequestIds.get(component);
    return ids?.[propertyName] ?? 0;
}

function bumpRequestId(component: any, propertyName: string): number {
    let ids = validationRequestIds.get(component);
    if (!ids) {
        ids = {};
        validationRequestIds.set(component, ids);
    }
    const next = (ids[propertyName] ?? 0) + 1;
    ids[propertyName] = next;
    return next;
}

/**
 * Validate a single property against its validation rules.
 *
 * @param trigger Optional hint describing what initiated this validation
 *   ('input' | 'blur' | 'submit'). When provided, validation is skipped unless
 *   the rule's configured trigger matches (or is 'all'). Omit to always
 *   validate regardless of config (used by `validateAll` on submit).
 */
export async function validateProperty(
    component: any,
    propertyName: string,
    trigger?: 'input' | 'blur' | 'submit'
): Promise<boolean> {
    const rules = getValidationRules(component);
    const propertyRules = rules[propertyName];

    if (!propertyRules) {
        return true;
    }

    const configTrigger = propertyRules.config.trigger || 'all';

    // If a trigger hint is provided, only validate when it matches the config
    // (or when the config is 'all'). No trigger hint = always validate.
    if (trigger && configTrigger !== 'all' && trigger !== configTrigger) {
        return true;
    }

    const value = resolveStatePath(component, propertyName);
    const { rules: validationRules, config } = propertyRules;

    // Determine where to run validation. Default to 'both' if unset (e.g. for
    // rules registered manually via setValidationRules without config defaults).
    const runOn = config.runOn || 'both';
    const shouldRunOnClient = runOn === 'client' || runOn === 'both';
    const shouldRunOnServer = runOn === 'server' || runOn === 'both';

    // Reserve a request ID for this async sequence. Any stale async result
    // (from a previous call whose ID is no longer the latest) will be ignored.
    const requestId = bumpRequestId(component, propertyName);

    let isValid = true;

    // Run client-side validation (sync and async)
    if (!component.isServer && shouldRunOnClient) {
        // Run sync validation first
        const syncResult = validateValue(value, validationRules);
        isValid = syncResult.valid;
        if (!isValid) {
            // Sync errors are applied immediately; they reflect the current
            // value, so no staleness concern.
            setValidationError(component, propertyName, syncResult.message || 'Validation failed');
        } else if (validationRules.customAsync) {
            // Run async validation if sync passes and there's a customAsync rule
            try {
                const asyncResult = await validateValueAsync(value, validationRules, component);
                // Discard stale result: a newer validation for this property
                // has already started. Do NOT mutate error state or re-render.
                if (getLatestRequestId(component, propertyName) !== requestId) {
                    return isValid;
                }
                isValid = asyncResult.valid;
                if (!asyncResult.valid) {
                    setValidationError(component, propertyName, asyncResult.message || 'Validation failed');
                }
            } catch (e) {
                if (getLatestRequestId(component, propertyName) !== requestId) {
                    return isValid;
                }
                isValid = false;
                setValidationError(component, propertyName, 'Validation failed');
            }
        }
    }

    // Run server-side validation
    if (component.isServer && shouldRunOnServer) {
        const result = await validateValueAsync(value, validationRules, component);
        if (getLatestRequestId(component, propertyName) !== requestId) {
            return isValid;
        }
        isValid = isValid && result.valid;
        if (!result.valid) {
            setValidationError(component, propertyName, result.message || 'Validation failed');
        }
    }

    // If valid, clear any existing error (guard against staleness here too)
    if (isValid) {
        if (getLatestRequestId(component, propertyName) === requestId) {
            clearValidationError(component, propertyName);
        }
    }

    return isValid;
}

/**
 * Validate all properties with validation rules.
 *
 * @param trigger Optional trigger hint forwarded to each `validateProperty`
 *   call. Omit to validate every field regardless of its configured trigger
 *   (used by form submit handlers).
 */
export async function validateAll(
    component: any,
    trigger?: 'input' | 'blur' | 'submit'
): Promise<boolean> {
    const rules = getValidationRules(component);
    const propertyNames = Object.keys(rules);

    const results = await Promise.all(
        propertyNames.map(name => validateProperty(component, name, trigger))
    );

    return results.every(result => result);
}

/** Clear all validation errors. */
export function clearErrors(component: any): void {
    const errorProperty = getValidationErrorProperty(component);
    const errors = component.getProperty(errorProperty);
    if (errors && typeof errors === 'object') {
        component.setProperty(errorProperty, {});
        if (!component.isServer) {
            component.requestUpdate();
        }
    }
}

