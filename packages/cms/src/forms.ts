/**
 * HTML form helpers for resource records: turn submitted form fields into typed input,
 * and records back into input values. Pure functions, safe on client and server.
 */
import type { FieldDeclaration } from './fields';
import type { RecordShape } from './records';

/** Values a form can submit: `FormData` or a plain map of strings. */
export type SubmittedForm = Pick<FormData, 'get' | 'getAll' | 'has'>;

export interface FormInput {
    readonly input: { [field: string]: unknown };
    /** Fields whose text could not be read as their kind. */
    readonly errors: { [field: string]: string };
}

/**
 * Read declared fields from a submitted form. Empty text means null for nullable fields and
 * "not provided" otherwise; checkboxes submit booleans; lists are comma or newline separated.
 */
export function formInput(fields: { readonly [name: string]: FieldDeclaration }, form: SubmittedForm, options: { only?: readonly string[] } = {}): FormInput {
    const input: { [field: string]: unknown } = {};
    const errors: { [field: string]: string } = {};
    for (const [name, declaration] of Object.entries(fields)) {
        if (options.only && !options.only.includes(name)) continue;
        if (declaration.kind === 'boolean') {
            input[name] = form.get(name) === 'on' || form.get(name) === 'true';
            continue;
        }
        if (!form.has(name)) continue;
        const raw = String(form.get(name) ?? '');
        const text = declaration.kind === 'text' || declaration.kind === 'json' ? raw : raw.trim();
        if (text === '') {
            if (declaration.nullable) input[name] = null;
            continue;
        }
        switch (declaration.kind) {
            case 'integer': {
                const value = Number(text);
                if (!Number.isSafeInteger(value)) errors[name] = 'must be a whole number.';
                else input[name] = value;
                break;
            }
            case 'number': {
                const value = Number(text);
                if (!Number.isFinite(value)) errors[name] = 'must be a number.';
                else input[name] = value;
                break;
            }
            case 'datetime': {
                // Forms show and submit UTC; a value without a zone is UTC.
                const value = Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text) ? `${text}Z` : text);
                if (Number.isNaN(value)) errors[name] = 'must be a date and time.';
                else input[name] = value;
                break;
            }
            case 'json': {
                try { input[name] = JSON.parse(text); }
                catch { errors[name] = 'must be valid JSON.'; }
                break;
            }
            case 'list': {
                const items = text.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
                if (declaration.items === 'string') input[name] = items;
                else if (declaration.items === 'boolean') input[name] = items.map(item => item === 'true');
                else {
                    const numbers = items.map(Number);
                    if (numbers.some(value => !Number.isFinite(value))) errors[name] = 'must list numbers.';
                    else input[name] = numbers;
                }
                break;
            }
            case 'vector': {
                const values = text.split(/[\s,]+/).filter(Boolean).map(Number);
                if (values.some(value => !Number.isFinite(value))) errors[name] = 'must list numbers.';
                else input[name] = values;
                break;
            }
            default: input[name] = text;
        }
    }
    return { input, errors };
}

/** The text a form control shows for a record value. */
export function formValue(declaration: FieldDeclaration, value: unknown): string {
    if (value === null || value === undefined) return '';
    switch (declaration.kind) {
        case 'datetime': return new Date(value as number).toISOString().slice(0, 16);
        case 'json': return JSON.stringify(value, null, 2);
        case 'list': return (value as unknown[]).join(', ');
        case 'vector': return (value as number[]).join(' ');
        default: return String(value);
    }
}

/** A short display text for a record: its title field, or its ID. */
export function recordTitle(record: RecordShape, titleField?: string): string {
    const value = titleField ? record[titleField] : undefined;
    return typeof value === 'string' && value ? value : record.id;
}

/** Same-origin check for form posts. Browsers send Sec-Fetch-Site and Origin on cross-site posts. */
export function isSameOriginPost(request: Request): boolean {
    const site = request.headers.get('sec-fetch-site');
    if (site !== null && !['same-origin', 'same-site', 'none'].includes(site.toLowerCase())) return false;
    const origin = request.headers.get('origin');
    if (origin === null) return true;
    try { return origin === new URL(request.url).origin; } catch { return false; }
}
