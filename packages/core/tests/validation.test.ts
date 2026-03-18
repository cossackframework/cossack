// tests/validation.test.ts
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { validateValue, validateValueAsync, getValidationRules, ValidationRule, ValidationConfig } from '../src/shared/validation';
import { Validate } from '../src/shared/decorators';

describe('Validation', () => {
    describe('validateValue', () => {
        describe('required', () => {
            it('should fail for empty string', () => {
                const rules: ValidationRule = { required: true };
                expect(validateValue('', rules).valid).toBe(false);
            });

            it('should fail for null', () => {
                const rules: ValidationRule = { required: true };
                expect(validateValue(null, rules).valid).toBe(false);
            });

            it('should fail for undefined', () => {
                const rules: ValidationRule = { required: true };
                expect(validateValue(undefined, rules).valid).toBe(false);
            });

            it('should pass for non-empty string', () => {
                const rules: ValidationRule = { required: true };
                expect(validateValue('hello', rules).valid).toBe(true);
            });

            it('should pass for non-empty array', () => {
                const rules: ValidationRule = { required: true };
                expect(validateValue([1, 2, 3], rules).valid).toBe(true);
            });

            it('should pass for number zero', () => {
                const rules: ValidationRule = { required: true };
                expect(validateValue(0, rules).valid).toBe(true);
            });
        });

        describe('minLength', () => {
            it('should fail for string shorter than minLength', () => {
                const rules: ValidationRule = { minLength: 5 };
                expect(validateValue('abc', rules).valid).toBe(false);
            });

            it('should pass for string equal to minLength', () => {
                const rules: ValidationRule = { minLength: 5 };
                expect(validateValue('abcde', rules).valid).toBe(true);
            });

            it('should pass for string longer than minLength', () => {
                const rules: ValidationRule = { minLength: 5 };
                expect(validateValue('abcdef', rules).valid).toBe(true);
            });

            it('should work on arrays', () => {
                const rules: ValidationRule = { minLength: 3 };
                expect(validateValue([1, 2], rules).valid).toBe(false);
                expect(validateValue([1, 2, 3], rules).valid).toBe(true);
            });
        });

        describe('maxLength', () => {
            it('should fail for string longer than maxLength', () => {
                const rules: ValidationRule = { maxLength: 5 };
                expect(validateValue('abcdef', rules).valid).toBe(false);
            });

            it('should pass for string equal to maxLength', () => {
                const rules: ValidationRule = { maxLength: 5 };
                expect(validateValue('abcde', rules).valid).toBe(true);
            });

            it('should pass for string shorter than maxLength', () => {
                const rules: ValidationRule = { maxLength: 5 };
                expect(validateValue('abc', rules).valid).toBe(true);
            });
        });

        describe('min', () => {
            it('should fail for number less than min', () => {
                const rules: ValidationRule = { min: 10 };
                expect(validateValue(5, rules).valid).toBe(false);
            });

            it('should pass for number equal to min', () => {
                const rules: ValidationRule = { min: 10 };
                expect(validateValue(10, rules).valid).toBe(true);
            });

            it('should pass for number greater than min', () => {
                const rules: ValidationRule = { min: 10 };
                expect(validateValue(15, rules).valid).toBe(true);
            });
        });

        describe('max', () => {
            it('should fail for number greater than max', () => {
                const rules: ValidationRule = { max: 10 };
                expect(validateValue(15, rules).valid).toBe(false);
            });

            it('should pass for number equal to max', () => {
                const rules: ValidationRule = { max: 10 };
                expect(validateValue(10, rules).valid).toBe(true);
            });

            it('should pass for number less than max', () => {
                const rules: ValidationRule = { max: 10 };
                expect(validateValue(5, rules).valid).toBe(true);
            });
        });

        describe('pattern', () => {
            it('should fail for string not matching pattern', () => {
                const rules: ValidationRule = { pattern: /^[a-z]+$/ };
                expect(validateValue('ABC', rules).valid).toBe(false);
            });

            it('should pass for string matching pattern', () => {
                const rules: ValidationRule = { pattern: /^[a-z]+$/ };
                expect(validateValue('abc', rules).valid).toBe(true);
            });
        });

        describe('email', () => {
            it('should fail for invalid email', () => {
                const rules: ValidationRule = { email: true };
                expect(validateValue('notanemail', rules).valid).toBe(false);
                expect(validateValue('missing@domain', rules).valid).toBe(false);
            });

            it('should pass for valid email', () => {
                const rules: ValidationRule = { email: true };
                expect(validateValue('test@example.com', rules).valid).toBe(true);
            });
        });

        describe('url', () => {
            it('should fail for invalid URL', () => {
                const rules: ValidationRule = { url: true };
                expect(validateValue('not-a-url', rules).valid).toBe(false);
            });

            it('should pass for valid URL', () => {
                const rules: ValidationRule = { url: true };
                expect(validateValue('https://example.com', rules).valid).toBe(true);
                expect(validateValue('http://example.com', rules).valid).toBe(true);
            });
        });

        describe('custom validator', () => {
            it('should use custom validator function', () => {
                const rules: ValidationRule = {
                    custom: (value: any) => value === 'secret'
                };
                expect(validateValue('secret', rules).valid).toBe(true);
                expect(validateValue('wrong', rules).valid).toBe(false);
            });

            it('should use custom message when provided', () => {
                const rules: ValidationRule = {
                    required: true,
                    message: 'Custom error message'
                };
                const result = validateValue('', rules);
                expect(result.valid).toBe(false);
                expect(result.message).toBe('Custom error message');
            });
        });

        describe('combined rules', () => {
            it('should validate multiple rules', () => {
                const rules: ValidationRule = {
                    required: true,
                    minLength: 3,
                    maxLength: 10
                };
                expect(validateValue('ab', rules).valid).toBe(false);
                expect(validateValue('abc', rules).valid).toBe(true);
                expect(validateValue('abcdefghijkl', rules).valid).toBe(false);
            });
        });
    });

    describe('validateValueAsync', () => {
        it('should return valid for sync rules', async () => {
            const rules: ValidationRule = { required: true };
            const result = await validateValueAsync('test', rules);
            expect(result.valid).toBe(true);
        });

        it('should fail for customAsync returning false', async () => {
            const rules: ValidationRule = {
                customAsync: async () => false
            };
            const result = await validateValueAsync('test', rules);
            expect(result.valid).toBe(false);
        });

        it('should pass for customAsync returning true', async () => {
            const rules: ValidationRule = {
                customAsync: async () => true
            };
            const result = await validateValueAsync('test', rules);
            expect(result.valid).toBe(true);
        });

        it('should run sync validation first, then async', async () => {
            const rules: ValidationRule = {
                required: true,
                customAsync: async () => false
            };
            const result = await validateValueAsync('', rules);
            // Should fail on required first (sync)
            expect(result.valid).toBe(false);
        });
    });

    describe('@Validate decorator', () => {
        it('should store validation rules in metadata', () => {
            class TestClass {
                @Validate({ rules: { required: true, email: true } })
                email = '';
            }

            const rules = getValidationRules(new TestClass());
            expect(rules.email).toBeDefined();
            expect(rules.email.rules.required).toBe(true);
            expect(rules.email.rules.email).toBe(true);
        });

        it('should store default config when not provided', () => {
            class TestClass {
                @Validate({ rules: { required: true } })
                field = '';
            }

            const rules = getValidationRules(new TestClass());
            expect(rules.field.config.trigger).toBe('all');
            expect(rules.field.config.runOn).toBe('both');
            expect(rules.field.config.errorProperty).toBe('errors');
        });

        it('should store custom config when provided', () => {
            class TestClass {
                @Validate({
                    rules: { required: true },
                    config: { trigger: 'blur', runOn: 'client', errorProperty: 'validationErrors', debounce: 300 }
                })
                field = '';
            }

            const rules = getValidationRules(new TestClass());
            expect(rules.field.config.trigger).toBe('blur');
            expect(rules.field.config.runOn).toBe('client');
            expect(rules.field.config.errorProperty).toBe('validationErrors');
            expect(rules.field.config.debounce).toBe(300);
        });

        it('should allow chaining @Validate on same property', () => {
            class TestClass {
                @Validate({ rules: { required: true } })
                @Validate({ rules: { email: true } })
                field = '';
            }

            const rules = getValidationRules(new TestClass());
            expect(rules.field).toBeDefined();
            // Last decorator wins for rules, but should merge
            expect(rules.field.rules.required || rules.field.rules.email).toBe(true);
        });
    });
});
