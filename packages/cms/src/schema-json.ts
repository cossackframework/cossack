/**
 * JSON Schema (draft 2020-12) for a resource's records as the content API answers and takes
 * them: one property per declared field, typed from its declaration. Editors use it for
 * completion and linting in the JSON tab; imports and API clients validate against it.
 * Client-safe.
 */
import type { FieldDeclaration } from './fields';

export type JsonSchema = { [keyword: string]: unknown };

const BLOCK_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        _id: { type: 'string', description: 'Distinct among the blocks of the field; 1 to 40 letters, digits, _ or -.' },
        type: { type: 'string', description: 'The block type, such as core/paragraph.' },
        data: { type: 'object', description: 'The block\'s fields, by name.' },
        layout: { type: 'object' },
        style: { type: 'object' },
        when: { type: 'object', description: 'In a form: when the block shows.' },
        children: { type: 'array', items: { $ref: '#/$defs/block' } },
    },
    required: ['_id', 'type', 'data'],
};

const RICH_TEXT_SCHEMA: JsonSchema = {
    type: 'object',
    description: 'A ProseMirror document.',
    properties: { type: { const: 'doc' }, content: { type: 'array', items: { type: 'object' } } },
    required: ['type', 'content'],
};

/** The schema of one value of the declaration's kind, before `multiple` and `nullable` apply. */
function valueSchema(declaration: FieldDeclaration): JsonSchema {
    switch (declaration.kind) {
        case 'string': return {
            type: 'string',
            ...(declaration.min !== undefined ? { minLength: declaration.min } : {}),
            ...(declaration.max !== undefined ? { maxLength: declaration.max } : {}),
            ...(declaration.pattern ? { pattern: `^(?:${declaration.pattern})$` } : {}),
            ...(declaration.media ? { description: 'The ID of a media file.' } : declaration.taxonomy ? { description: `The ID of a ${declaration.taxonomy} term.` } : {}),
        };
        case 'text': return {
            type: 'string',
            ...(declaration.min !== undefined ? { minLength: declaration.min } : {}),
            ...(declaration.max !== undefined ? { maxLength: declaration.max } : {}),
            ...(declaration.format === 'markdown' ? { description: 'Markdown.' } : {}),
        };
        case 'enum': return { type: 'string', enum: [...(declaration.values ?? [])] };
        case 'integer': return { type: 'integer', ...(declaration.min !== undefined ? { minimum: declaration.min } : {}), ...(declaration.max !== undefined ? { maximum: declaration.max } : {}) };
        case 'datetime': return { type: 'integer', description: 'Milliseconds since 1970-01-01T00:00:00Z.' };
        case 'bigint': return { type: 'string', pattern: '^-?[0-9]+$', description: 'A big integer, as a decimal string.' };
        case 'number': return { type: 'number', ...(declaration.min !== undefined ? { minimum: declaration.min } : {}), ...(declaration.max !== undefined ? { maximum: declaration.max } : {}) };
        case 'boolean': return { type: 'boolean' };
        case 'reference': return { type: 'string', description: `The ID of a ${declaration.target ?? ''} record.` };
        case 'vector': return { type: 'array', items: { type: 'number' }, ...(declaration.dimensions ? { minItems: declaration.dimensions, maxItems: declaration.dimensions } : {}) };
        case 'blocks': return { type: 'array', items: { $ref: '#/$defs/block' }, ...(declaration.blocks ? { description: `Blocks of these types: ${declaration.blocks.join(', ')}.` } : {}) };
        case 'richtext': return { $ref: '#/$defs/richText' };
        case 'rows': return {
            type: 'array',
            items: { type: 'object', properties: { _id: { type: 'string' }, ...propertiesOf(declaration.fields ?? {}) }, required: requiredOf(declaration.fields ?? {}) },
            ...(declaration.min !== undefined ? { minItems: declaration.min } : {}),
            ...(declaration.max !== undefined ? { maxItems: declaration.max } : {}),
        };
        case 'json': return declaration.fields && Object.keys(declaration.fields).length
            ? { type: 'object', properties: propertiesOf(declaration.fields) }
            : { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] };
    }
}

/** A field's schema: the value, a list of them for multiple fields, null allowed when nullable. */
export function fieldSchema(declaration: FieldDeclaration): JsonSchema {
    const value = valueSchema(declaration);
    const shaped = declaration.multiple
        ? { type: 'array', items: value, ...(declaration.minItems !== undefined ? { minItems: declaration.minItems } : {}), ...(declaration.maxItems !== undefined ? { maxItems: declaration.maxItems } : {}) }
        : value;
    const described = { ...(declaration.label ? { title: declaration.label } : {}), ...(declaration.description ? { description: declaration.description } : {}), ...(declaration.default !== undefined ? { default: declaration.default } : {}) };
    return declaration.nullable && !declaration.multiple ? { ...described, anyOf: [shaped, { type: 'null' }] } : { ...described, ...shaped };
}

function propertiesOf(fields: { readonly [name: string]: FieldDeclaration }): { [name: string]: JsonSchema } {
    return Object.fromEntries(Object.entries(fields).map(([name, declaration]) => [name, fieldSchema(declaration)]));
}

function requiredOf(fields: { readonly [name: string]: FieldDeclaration }): string[] {
    return Object.entries(fields).filter(([, declaration]) => declaration.required).map(([name]) => name);
}

/**
 * The schema of a resource's records: its fields, and the read-only properties every record
 * carries (`id`, `rev`, the dates, `owner`, `url`). Unknown properties are rejected, as a
 * write would reject them.
 */
export function recordSchema(resource: { readonly id: string; readonly label?: string; readonly fields: { readonly [name: string]: FieldDeclaration } }): JsonSchema {
    return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: `urn:cossack:cms:${resource.id}`,
        title: resource.label ?? resource.id,
        type: 'object',
        properties: {
            id: { type: 'string', readOnly: true },
            rev: { type: 'integer', readOnly: true, description: 'The revision number; grows with every write.' },
            createdAt: { type: 'integer', readOnly: true },
            updatedAt: { type: 'integer', readOnly: true },
            owner: { type: ['string', 'null'], readOnly: true },
            url: { type: ['string', 'null'], readOnly: true, description: 'The public URL, when the entry is on the site.' },
            ...propertiesOf(resource.fields),
        },
        required: requiredOf(resource.fields),
        additionalProperties: false,
        $defs: { block: BLOCK_SCHEMA, richText: RICH_TEXT_SCHEMA },
    };
}
