// tests/validation.test.ts
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { validateValue, validateValueAsync, validateProperty, validateAll, getValidationRules, validateObject, ValidationRule, ValidationConfig, storeRules } from '../src/shared/validation';
import { Validate, Store } from '../src/shared/decorators';

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

    describe('validateProperty / validateAll', () => {
        /**
         * Build a minimal component mock that has the methods touched by
         * validateProperty/validateAll (getProperty, setProperty,
         * requestUpdate, isServer) and the `cossack:validation` metadata
         * populated via the real @Validate decorator.
         */
        function makeComponent<T extends new (...args: any[]) => any>(
            Klass: T,
            initialValues: Record<string, any> = {}
        ): InstanceType<T> & {
            // Backed by a Record<string, any> store, so values are loosely typed.
            getProperty(name: string): any;
            setProperty(name: string, value: any): void;
            requestUpdate(): void;
            isServer: boolean;
        } {
            const comp = new Klass() as any;
            const store: Record<string, any> = { errors: {}, ...initialValues };
            // @Validate decorates properties on the prototype; copy initial
            // values onto the instance so getProperty returns them.
            comp.getProperty = (name: string) => store[name];
            comp.setProperty = (name: string, value: any) => { store[name] = value; };
            comp.requestUpdate = vi.fn();
            comp.isServer = false;
            return comp;
        }

        class ValidationComponent {
            @Validate({
                rules: { required: true },
                config: { trigger: 'blur', runOn: 'both' }
            })
            blurField = '';

            @Validate({
                rules: { required: true },
                config: { trigger: 'input', runOn: 'both' }
            })
            inputField = '';

            @Validate({
                rules: { required: true },
                config: { trigger: 'all', runOn: 'both' }
            })
            allField = '';
        }

        describe('trigger config', () => {
            it('skips validation when trigger hint does not match config trigger', async () => {
                const comp = makeComponent(ValidationComponent, { blurField: '' });
                // blurField is configured for 'blur'; 'input' hint should skip it.
                const result = await validateProperty(comp, 'blurField', 'input');
                expect(result).toBe(true);
                // No error should have been set (required would have failed otherwise).
                expect(comp.getProperty('errors').blurField).toBeUndefined();
            });

            it('validates when trigger hint matches config trigger', async () => {
                const comp = makeComponent(ValidationComponent, { blurField: '' });
                const result = await validateProperty(comp, 'blurField', 'blur');
                expect(result).toBe(false);
                expect(comp.getProperty('errors').blurField).toBeDefined();
            });

            it('validates when config trigger is "all" regardless of hint', async () => {
                const comp = makeComponent(ValidationComponent, { allField: '' });
                // 'input' hint
                expect(await validateProperty(comp, 'allField', 'input')).toBe(false);
                // 'blur' hint
                const comp2 = makeComponent(ValidationComponent, { allField: '' });
                expect(await validateProperty(comp2, 'allField', 'blur')).toBe(false);
            });

            it('always validates when no trigger hint is provided (backward compat)', async () => {
                const comp = makeComponent(ValidationComponent, { blurField: '' });
                // No trigger hint: should validate even though config trigger is 'blur'.
                const result = await validateProperty(comp, 'blurField');
                expect(result).toBe(false);
                expect(comp.getProperty('errors').blurField).toBeDefined();
            });

            it('validateAll with no trigger validates every field regardless of config', async () => {
                const comp = makeComponent(ValidationComponent, {
                    blurField: '',
                    inputField: '',
                    allField: ''
                });
                const result = await validateAll(comp);
                // All three required fields are empty -> invalid.
                expect(result).toBe(false);
                const errors = comp.getProperty('errors');
                expect(errors.blurField).toBeDefined();
                expect(errors.inputField).toBeDefined();
                expect(errors.allField).toBeDefined();
            });

            it('validateAll with a trigger hint only validates matching fields', async () => {
                const comp = makeComponent(ValidationComponent, {
                    blurField: '',
                    inputField: '',
                    allField: ''
                });
                // With 'blur' hint: inputField (trigger 'input') should be skipped.
                await validateAll(comp, 'blur');
                const errors = comp.getProperty('errors');
                expect(errors.blurField).toBeDefined(); // matched
                expect(errors.inputField).toBeUndefined(); // skipped
                expect(errors.allField).toBeDefined(); // 'all' matches anything
            });
        });

        describe('stale async guard', () => {
            it('discards stale async results when a newer validation starts', async () => {
                let resolveFirst: (v: boolean) => void = () => {};
                let resolveSecond: (v: boolean) => void = () => {};
                const firstCall = new Promise<boolean>(r => { resolveFirst = r; });
                const secondCall = new Promise<boolean>(r => { resolveSecond = r; });
                let callCount = 0;

                class AsyncComponent {
                    @Validate({
                        rules: {
                            customAsync: async () => {
                                callCount++;
                                return callCount === 1 ? firstCall : secondCall;
                            },
                            message: 'Invalid value'
                        },
                        config: { trigger: 'all', runOn: 'both' }
                    })
                    field = '';
                }

                const comp = makeComponent(AsyncComponent, { field: 'x' });

                // Start the first validation (will hang on firstCall).
                const p1 = validateProperty(comp, 'field');
                // Start the second validation before the first resolves.
                const p2 = validateProperty(comp, 'field');

                // Resolve the FIRST (now stale) validation as invalid.
                resolveFirst(false);
                // Resolve the SECOND (current) validation as valid.
                resolveSecond(true);

                // Wait for both to complete.
                const [r1, r2] = await Promise.all([p1, p2]);

                // The stale (first) result must be ignored: no error state
                // mutation, returns its own isValid (true, since sync passed
                // and async was discarded before being applied).
                // The current (second) result applies: valid.
                const errors = comp.getProperty('errors');
                expect(errors.field).toBeUndefined();
                expect(r2).toBe(true);
                // r1 also returns true because it bailed out before applying
                // its own invalid result (and sync validation passed).
                // We mainly assert no error was set from the stale call.
                void r1;
            });

            it('keeps the latest result even if it arrives after a stale valid result', async () => {
                let resolveFirst: (v: boolean) => void = () => {};
                let resolveSecond: (v: boolean) => void = () => {};
                const firstCall = new Promise<boolean>(r => { resolveFirst = r; });
                const secondCall = new Promise<boolean>(r => { resolveSecond = r; });
                let callCount = 0;

                class AsyncComponent {
                    @Validate({
                        rules: {
                            customAsync: async () => {
                                callCount++;
                                return callCount === 1 ? firstCall : secondCall;
                            },
                            message: 'Invalid value'
                        },
                        config: { trigger: 'all', runOn: 'both' }
                    })
                    field = '';
                }

                const comp = makeComponent(AsyncComponent, { field: 'x' });

                const p1 = validateProperty(comp, 'field');
                const p2 = validateProperty(comp, 'field');

                // First (stale) resolves valid, second (current) resolves invalid.
                resolveFirst(true);
                resolveSecond(false);

                await Promise.all([p1, p2]);

                // The current (invalid) result should be the one applied.
                const errors = comp.getProperty('errors');
                expect(errors.field).toBe('Invalid value');
            });
        });
    });

    describe('store / dot-path validation', () => {
        /**
         * Build a minimal component mock backed by a Record store, with
         * nested stores materialized so resolveStatePath can walk them.
         */
        function makeStoreComponent<T extends new (...args: any[]) => any>(
            Klass: T,
            initialValues: Record<string, any> = {},
        ): InstanceType<T> & {
            getProperty(name: string): any;
            setProperty(name: string, value: any): void;
            requestUpdate(): void;
            isServer: boolean;
        } {
            const comp = new Klass() as any;
            const store: Record<string, any> = { errors: {}, ...initialValues };
            comp.getProperty = (name: string) => store[name];
            comp.setProperty = (name: string, value: any) => { store[name] = value; };
            comp.requestUpdate = vi.fn();
            comp.isServer = false;
            return comp;
        }

        class StoreValidationComponent {
            @Validate({
                rules: {
                    'form.email': { required: true, email: true, message: 'Bad email' },
                    'form.address.zip': {
                        required: true,
                        pattern: /^\d{5}$/,
                        message: 'Bad ZIP',
                    },
                    'form.tags': { required: true, minLength: 1, message: 'Add a tag' },
                },
                config: { trigger: 'all', runOn: 'both' },
            })
            form: any;
        }

        it('reads a nested value via dot-path for validation', async () => {
            const comp = makeStoreComponent(StoreValidationComponent, {
                form: { email: 'not-an-email', address: { zip: '' }, tags: [] },
            });
            const valid = await validateProperty(comp, 'form.email');
            expect(valid).toBe(false);
            expect(comp.getProperty('errors')['form.email']).toBe('Bad email');
        });

        it('passes for a valid nested value and clears any prior error', async () => {
            const comp = makeStoreComponent(StoreValidationComponent, {
                form: { email: 'good@example.com', address: { zip: '' }, tags: [] },
            });
            // Seed an error, then validate a passing value to confirm it clears.
            comp.getProperty('errors')['form.email'] = 'stale';
            const valid = await validateProperty(comp, 'form.email');
            expect(valid).toBe(true);
            expect(comp.getProperty('errors')['form.email']).toBeUndefined();
        });

        it('resolves a multi-level dot-path (form.address.zip)', async () => {
            const comp = makeStoreComponent(StoreValidationComponent, {
                form: { email: 'a@b.com', address: { zip: 'abc' }, tags: ['x'] },
            });
            const valid = await validateProperty(comp, 'form.address.zip');
            expect(valid).toBe(false);
            expect(comp.getProperty('errors')['form.address.zip']).toBe('Bad ZIP');
        });

        it('validates an array field by dot-path (minLength)', async () => {
            const comp = makeStoreComponent(StoreValidationComponent, {
                form: { email: 'a@b.com', address: { zip: '12345' }, tags: [] },
            });
            const valid = await validateProperty(comp, 'form.tags');
            expect(valid).toBe(false);
            expect(comp.getProperty('errors')['form.tags']).toBe('Add a tag');
        });

        it('validateAll validates every dot-path rule', async () => {
            const comp = makeStoreComponent(StoreValidationComponent, {
                form: { email: 'bad', address: { zip: 'bad' }, tags: [] },
            });
            const valid = await validateAll(comp);
            expect(valid).toBe(false);
            const errors = comp.getProperty('errors');
            expect(errors['form.email']).toBeDefined();
            expect(errors['form.address.zip']).toBeDefined();
            expect(errors['form.tags']).toBeDefined();
        });

        it('validateAll passes when every nested field is valid', async () => {
            const comp = makeStoreComponent(StoreValidationComponent, {
                form: {
                    email: 'good@example.com',
                    address: { zip: '12345' },
                    tags: ['x'],
                },
            });
            const valid = await validateAll(comp);
            expect(valid).toBe(true);
        });

        it('customAsync receives the component and resolves a nested value', async () => {
            class AsyncStoreComponent {
                @Validate({
                    rules: {
                        'form.code': {
                            required: true,
                            customAsync: async (value: string, component: any) => {
                                return component.check(value);
                            },
                            message: 'Invalid code',
                        },
                    },
                    config: { trigger: 'all', runOn: 'both' },
                })
                form: any;
            }
            const comp = makeStoreComponent(AsyncStoreComponent, {
                form: { code: 'WRONG' },
            });
            (comp as any).check = vi.fn().mockResolvedValue(false);
            const valid = await validateProperty(comp, 'form.code');
            expect(valid).toBe(false);
            expect((comp as any).check).toHaveBeenCalledWith('WRONG');
            expect(comp.getProperty('errors')['form.code']).toBe('Invalid code');
        });

        it('returns true for a dot-path with no registered rule (no-op)', async () => {
            const comp = makeStoreComponent(StoreValidationComponent, {
                form: { email: '', address: { zip: '' }, tags: [] },
            });
            const valid = await validateProperty(comp, 'form.unknown');
            expect(valid).toBe(true);
            // No error set for the unknown path.
            expect(comp.getProperty('errors')['form.unknown']).toBeUndefined();
        });

        it('backward-compat: flat single-rule fields still validate via getProperty', async () => {
            class FlatComponent {
                @Validate({
                    rules: { required: true, message: 'Required' },
                    config: { trigger: 'all', runOn: 'both' },
                })
                email = '';
            }
            const comp = makeStoreComponent(FlatComponent, { email: '' });
            const valid = await validateProperty(comp, 'email');
            expect(valid).toBe(false);
            expect(comp.getProperty('errors').email).toBe('Required');
        });

        it('end-to-end: storeRules relative keys validate via the full prefixed path', async () => {
            interface FormShape { email: string; address: { zip: string } }
            class StoreRulesComponent {
                @Store()
                @Validate({
                    rules: storeRules<FormShape>({
                        email: { required: true, email: true, message: 'Bad email' },
                        'address.zip': { required: true, pattern: /^\d{5}$/, message: 'Bad ZIP' },
                    }),
                    config: { trigger: 'all', runOn: 'both' },
                })
                form: any;
            }
            const comp = makeStoreComponent(StoreRulesComponent, {
                form: { email: 'not-an-email', address: { zip: 'abc' } },
            });
            // Relative keys are registered under full prefixed paths, so
            // validateProperty must use the full path.
            const emailValid = await validateProperty(comp, 'form.email');
            expect(emailValid).toBe(false);
            expect(comp.getProperty('errors')['form.email']).toBe('Bad email');

            const zipValid = await validateProperty(comp, 'form.address.zip');
            expect(zipValid).toBe(false);
            expect(comp.getProperty('errors')['form.address.zip']).toBe('Bad ZIP');

            // validateAll covers the storeRules-registered paths.
            const allValid = await validateAll(comp);
            expect(allValid).toBe(false);
        });
    });

    describe('validateObject (standalone, component-free)', () => {
        interface MyForm {
            name: string;
            email: string;
            address: { zip: string };
            tags: string[];
        }

        it('returns valid=true and no errors when all rules pass', async () => {
            const data: MyForm = {
                name: 'Alice',
                email: 'alice@example.com',
                address: { zip: '12345' },
                tags: ['a'],
            };
            const { valid, errors, data: out } = await validateObject(data, {
                name: { required: true },
                email: { required: true, email: true },
                'address.zip': { required: true, pattern: /^\d{5}$/ },
            });
            expect(valid).toBe(true);
            expect(errors).toEqual({});
            // data is echoed back, unchanged.
            expect(out).toBe(data);
        });

        it('collects the first failing message per dot-path key', async () => {
            const data: MyForm = {
                name: '',
                email: 'not-an-email',
                address: { zip: 'abc' },
                tags: [],
            };
            const { valid, errors } = await validateObject(data, {
                name: { required: true, message: 'Name is required' },
                email: { email: true, message: 'Bad email' },
                'address.zip': { required: true, pattern: /^\d{5}$/, message: 'Bad ZIP' },
            });
            expect(valid).toBe(false);
            expect(errors['name']).toBe('Name is required');
            expect(errors['email']).toBe('Bad email');
            expect(errors['address.zip']).toBe('Bad ZIP');
        });

        it('resolves nested dot-paths and reports missing intermediate keys', async () => {
            const data = { address: {} } as unknown as MyForm;
            const { valid, errors } = await validateObject(data, {
                'address.zip': { required: true, message: 'ZIP required' },
            });
            expect(valid).toBe(false);
            expect(errors['address.zip']).toBe('ZIP required');
        });

        it('returns valid=true when no rules are provided', async () => {
            const data: MyForm = {
                name: '', email: '', address: { zip: '' }, tags: [],
            };
            const { valid, errors } = await validateObject(data, {});
            expect(valid).toBe(true);
            expect(errors).toEqual({});
        });

        it('supports customAsync rules (no component passed)', async () => {
            const data: MyForm = {
                name: 'x', email: 'a@b.com', address: { zip: '12345' }, tags: [],
            };
            const check = vi.fn(async (value: string) => value === 'ok');
            const { valid } = await validateObject(data, {
                name: { customAsync: check, message: 'must be ok' },
            });
            expect(valid).toBe(false);
            // customAsync was invoked with the value and no component.
            expect(check).toHaveBeenCalledWith('x', undefined);
        });

        it('works on null-proto objects (from parseFormData)', async () => {
            // Simulate a parsed form result: null-proto containers.
            const data = Object.assign(Object.create(null), {
                name: 'Alice',
                address: Object.assign(Object.create(null), { zip: '12345' }),
            }) as unknown as MyForm;
            const { valid } = await validateObject(data, {
                name: { required: true },
                'address.zip': { required: true, pattern: /^\d{5}$/ },
            });
            expect(valid).toBe(true);
        });
    });
});
