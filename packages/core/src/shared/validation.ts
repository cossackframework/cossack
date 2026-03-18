// src/shared/validation.ts

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
